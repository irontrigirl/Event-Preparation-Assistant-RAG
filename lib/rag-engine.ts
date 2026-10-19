/**
 * RAG Engine — Document loading, chunking, BM25 retrieval, query transformation
 * Singleton module: initialized once on first request, cached in-memory.
 * Uses BM25-style term-frequency scoring for retrieval (no external vector DB needed).
 */

const ABACUS_API_URL = 'https://apps.abacus.ai/v1';

export interface Chunk {
  id: string;
  source_file: string;
  record_id: string;
  section_title: string;
  text: string;
  terms: Record<string, number>; // term -> frequency
  length: number;
}

export interface RetrievedChunk {
  file: string;
  record_id: string;
  section_title: string;
  score: number;
  text: string;
}

export interface DocumentSummary {
  name: string;
  label: string;
  record_count: number;
  description: string;
}

let chunks: Chunk[] = [];
let initialized = false;
let initializing: Promise<void> | null = null;
let documentSummaries: DocumentSummary[] = [];
let avgDocLength = 0;
let idf: Record<string, number> = {};

// --- Text processing ---
const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','can','could',
  'of','in','to','for','with','on','at','from','by','about','as','into','through',
  'during','before','after','above','below','between','out','off','over','under',
  'again','further','then','once','and','but','or','nor','not','no','so','if',
  'that','this','these','those','it','its','he','she','they','them','his','her',
  'their','what','which','who','whom','when','where','why','how','all','each',
  'every','both','few','more','most','other','some','such','than','too','very',
]);

function tokenize(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t: string) => t.length > 1 && !STOP_WORDS.has(t));
}

function termFrequency(tokens: string[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const t of tokens) {
    freq[t] = (freq[t] ?? 0) + 1;
  }
  return freq;
}

// BM25 scoring
const BM25_K1 = 1.5;
const BM25_B = 0.75;

function bm25Score(queryTerms: string[], chunk: Chunk): number {
  let score = 0;
  for (const term of queryTerms) {
    const tf = chunk.terms[term] ?? 0;
    if (tf === 0) continue;
    const termIdf = idf[term] ?? 0;
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / (avgDocLength || 1)));
    score += termIdf * (numerator / denominator);
  }
  return score;
}

// --- CSV parsing ---
function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = (lines[0] ?? '').split(',').map((h: string) => h.trim());
  return lines.slice(1).map((line: string) => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h: string, i: number) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// --- Chunking ---
function chunkSchedule(csv: string): Omit<Chunk, 'terms' | 'length'>[] {
  const rows = parseCSV(csv);
  return rows.map((r: Record<string, string>) => {
    const text = `Session ${r['session_id']}: ${r['session_title']} | Type: ${r['session_type']} | Date: ${r['date']} | Time: ${r['start_time']}–${r['end_time']} | Room: ${r['room'] || 'N/A'} | Speaker: ${r['speaker_id'] || 'None'} | Capacity: ${r['max_capacity'] || 'N/A'} | Notes: ${r['notes'] || 'None'}`;
    return {
      id: `schedule-${r['session_id']}`,
      source_file: 'event_schedule.csv',
      record_id: r['session_id'] ?? '',
      section_title: r['session_title'] ?? '',
      text,
    };
  });
}

function chunkSpeakers(csv: string): Omit<Chunk, 'terms' | 'length'>[] {
  const rows = parseCSV(csv);
  return rows.map((r: Record<string, string>) => {
    const text = `Speaker ${r['speaker_id']}: ${r['full_name']} | Title: ${r['title']} | Organisation: ${r['organisation']} | Bio: ${r['bio']} | Sessions: ${r['session_ids']} | Dietary: ${r['dietary_requirement'] || 'None'} | Travel Support: ${r['travel_support']} | Confirmed: ${r['confirmed']}`;
    return {
      id: `speaker-${r['speaker_id']}`,
      source_file: 'speaker_directory.csv',
      record_id: r['speaker_id'] ?? '',
      section_title: r['full_name'] ?? '',
      text,
    };
  });
}

function chunkPolicies(json: string): Omit<Chunk, 'terms' | 'length'>[] {
  const data = JSON.parse(json);
  const result: Omit<Chunk, 'terms' | 'length'>[] = [];
  for (const section of data?.sections ?? []) {
    for (const policy of section?.policies ?? []) {
      result.push({
        id: `policy-${policy.policy_id}`,
        source_file: 'attendance_policies.json',
        record_id: policy.policy_id ?? '',
        section_title: section.title ?? '',
        text: `Policy ${policy.policy_id} (${section.title}): ${policy.rule}`,
      });
    }
  }
  return result;
}

// --- Initialization ---
export async function initializeRAG(): Promise<void> {
  if (initialized) return;
  if (initializing) { await initializing; return; }

  initializing = (async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dataDir = path.join(process.cwd(), 'data');

    const scheduleCSV = fs.readFileSync(path.join(dataDir, 'event_schedule.csv'), 'utf-8');
    const speakerCSV = fs.readFileSync(path.join(dataDir, 'speaker_directory.csv'), 'utf-8');
    const policyJSON = fs.readFileSync(path.join(dataDir, 'attendance_policies.json'), 'utf-8');

    const scheduleChunks = chunkSchedule(scheduleCSV);
    const speakerChunks = chunkSpeakers(speakerCSV);
    const policyChunks = chunkPolicies(policyJSON);

    const allRawChunks = [...scheduleChunks, ...speakerChunks, ...policyChunks];

    // Build BM25 index
    chunks = allRawChunks.map((c) => {
      const tokens = tokenize(c.text);
      return {
        ...c,
        terms: termFrequency(tokens),
        length: tokens.length,
      };
    });

    // Compute average document length
    avgDocLength = chunks.reduce((sum, c) => sum + c.length, 0) / (chunks.length || 1);

    // Compute IDF for all terms
    const docFreq: Record<string, number> = {};
    for (const chunk of chunks) {
      for (const term of Object.keys(chunk.terms)) {
        docFreq[term] = (docFreq[term] ?? 0) + 1;
      }
    }
    const N = chunks.length;
    for (const [term, df] of Object.entries(docFreq)) {
      idf[term] = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    }

    documentSummaries = [
      { name: 'event_schedule.csv', label: '📅 Event Schedule', record_count: scheduleChunks.length, description: `${scheduleChunks.length} sessions for the BeaconComms Annual Comms Summit 2026 on 14 Nov 2026` },
      { name: 'speaker_directory.csv', label: '👤 Speaker Directory', record_count: speakerChunks.length, description: `${speakerChunks.length} speakers with bios, session assignments, dietary requirements` },
      { name: 'attendance_policies.json', label: '📋 Attendance Policies', record_count: policyChunks.length, description: `${policyChunks.length} policy rules across ${(JSON.parse(policyJSON)?.sections ?? []).length} sections` },
    ];

    initialized = true;
  })();

  await initializing;
}

// --- Retrieval ---
export async function retrieve(query: string, topK: number = 5): Promise<RetrievedChunk[]> {
  await initializeRAG();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = chunks.map((c) => ({
    chunk: c,
    score: bm25Score(queryTokens, c),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Normalize scores to 0-1 range for threshold checking
  const maxScore = scored[0]?.score ?? 0;
  
  return scored.slice(0, topK).map((s) => {
    const normalizedScore = maxScore > 0 ? s.score / maxScore : 0;
    return {
      file: s.chunk.source_file,
      record_id: s.chunk.record_id,
      section_title: s.chunk.section_title,
      score: Math.round(normalizedScore * 1000) / 1000,
      text: s.chunk.text,
    };
  });
}

export function getDocumentSummaries(): DocumentSummary[] {
  return documentSummaries;
}

export function getTotalChunks(): number {
  return chunks.length;
}

export function isInitialized(): boolean {
  return initialized;
}

// --- Query Transformation ---
export async function transformQuery(rawQuery: string): Promise<string> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('ABACUSAI_API_KEY not set');

  const response = await fetch(`${ABACUS_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      messages: [
        {
          role: 'system',
          content: `You are a query transformation engine for BM25 keyword search. Rewrite the user's casual question into a precise keyword-rich search query for a knowledge base about the BeaconComms Annual Comms Summit 2026. The knowledge base contains: event schedule (sessions, times, rooms, speakers), speaker directory (names, bios, dietary needs), and attendance policies (registration, cancellation, accessibility, photography rules). Output ONLY the transformed query — no explanation, no quotes, no formatting. Add relevant synonyms and related terms.`,
        },
        { role: 'user', content: rawQuery },
      ],
      max_tokens: 100,
      temperature: 0.1,
    }),
  });

  if (!response.ok) return rawQuery;
  const result = await response.json();
  return result?.choices?.[0]?.message?.content?.trim() ?? rawQuery;
}
