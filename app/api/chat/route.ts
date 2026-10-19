export const dynamic = 'force-dynamic';

import { initializeRAG, retrieve, transformQuery } from '@/lib/rag-engine';
import type { RetrievedChunk } from '@/lib/rag-engine';

const ABACUS_API_URL = 'https://apps.abacus.ai/v1';
const MIN_RELEVANCE_THRESHOLD = 0.3;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function POST(request: Request) {
  try {
    await initializeRAG();
    const body = await request.json();
    const query: string = body?.query ?? '';
    const conversationHistory: ChatMessage[] = body?.messages ?? [];

    if (!query.trim()) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }

    const apiKey = process.env.ABACUSAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'API key not configured' }, { status: 500 });
    }

    // Step 1: Transform the query
    const transformedQuery = await transformQuery(query);

    // Step 2: Retrieve relevant chunks
    const retrievedChunks = await retrieve(transformedQuery, 5);

    // Step 3: Check relevance threshold (BM25 scores are normalized 0-1 in retrieve())
    const maxScore = retrievedChunks?.[0]?.score ?? 0;
    if (maxScore < MIN_RELEVANCE_THRESHOLD) {
      const noMatchResponse = JSON.stringify({
        status: 'completed',
        answer: 'No relevant documents found in the knowledge base for your query. Please try rephrasing your question or ask about the event schedule, speakers, or attendance policies.',
        sources: [],
        transformed_query: transformedQuery,
      });
      return new Response(
        `data: ${noMatchResponse}\n\ndata: [DONE]\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      );
    }

    // Step 4: Build context from retrieved chunks
    const contextText = retrievedChunks
      .map((c: RetrievedChunk, i: number) => `[${i + 1}] Source: ${c.file} | Record: ${c.record_id} | Relevance: ${c.score}\n${c.text}`)
      .join('\n\n');

    // Step 5: Build messages with conversation history (last 3 turns)
    const recentHistory = conversationHistory.slice(-6); // 3 turns = 6 messages (user+assistant)
    const systemPrompt = `You are the Event Preparation Assistant for the BeaconComms Annual Comms Summit 2026 (14 November 2026). You help delegates, organisers, and speakers find information about the event.

INSTRUCTIONS:
- Answer ONLY based on the retrieved documents provided below.
- After each fact, cite the source in brackets like [event_schedule.csv · S002] or [attendance_policies.json · AP03-01].
- Use bullet points for lists and tables for comparisons when appropriate.
- If the information is not in the retrieved documents, say explicitly: "This information is not available in the knowledge base."
- Be concise, professional, and helpful.
- If the user asks about something partially covered, share what you have and note what's missing.

RETRIEVED DOCUMENTS:
${contextText}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: query },
    ];

    // Step 6: Stream the LLM response
    const llmResponse = await fetch(`${ABACUS_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages,
        stream: true,
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      return Response.json(
        { error: `LLM API error: ${llmResponse.status} ${errText}` },
        { status: 500 }
      );
    }

    // Stream back to the client
    const stream = new ReadableStream({
      async start(controller) {
        const reader = llmResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let buffer = '';
        let partialRead = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            partialRead += decoder.decode(value, { stream: true });
            const lines = partialRead.split('\n');
            partialRead = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  // Send final complete response
                  const finalData = JSON.stringify({
                    status: 'completed',
                    answer: buffer,
                    sources: retrievedChunks,
                    transformed_query: transformedQuery,
                  });
                  controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
                  controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                  controller.close();
                  return;
                }
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed?.choices?.[0]?.delta?.content ?? '';
                  buffer += delta;
                  if (delta) {
                    const chunkData = JSON.stringify({
                      status: 'streaming',
                      delta,
                      partial: buffer,
                    });
                    controller.enqueue(encoder.encode(`data: ${chunkData}\n\n`));
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }

          // If we exit the loop without [DONE], send what we have
          if (buffer) {
            const finalData = JSON.stringify({
              status: 'completed',
              answer: buffer,
              sources: retrievedChunks,
              transformed_query: transformedQuery,
            });
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        } catch (error: any) {
          const errData = JSON.stringify({
            status: 'error',
            message: error?.message ?? 'Stream error',
          });
          controller.enqueue(encoder.encode(`data: ${errData}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    );
  }
}
