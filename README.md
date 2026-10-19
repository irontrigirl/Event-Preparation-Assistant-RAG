# Event Preparation Assistant — RAG Demo

> **Part 1** of the BeaconComms technical interview challenge.
> A conversational AI assistant for the **BeaconComms Annual Comms Summit 2026**, powered by Retrieval-Augmented Generation.

---

## What It Does

Users ask natural-language questions about the summit — schedule, speakers, attendance policies — and get **grounded, source-cited answers** drawn exclusively from the event knowledge base.

**Key capabilities:**
- Streaming chat responses with real-time token output
- Source citations showing which document and record each answer draws from
- Query transformation (the raw user question is rewritten for better retrieval)
- Relevance gating — if no document scores above the threshold, the assistant admits it doesn't know rather than hallucinating
- Conversational memory (last 3 turns)

---

## Architecture

```
User Question
     │
     ▼
Query Transformation (LLM rewrites for retrieval)
     │
     ▼
BM25 Retrieval (TF-IDF weighted, top-5 chunks)
     │
     ▼
Relevance Gate (score ≥ 0.30 to proceed)
     │
     ▼
Grounded Generation (LLM with retrieved context + system prompt)
     │
     ▼
Streaming Response with [source · record_id] citations
```

### Retrieval Engine — `lib/rag-engine.ts`

The retrieval layer uses **BM25 (Best Match 25)** — a classical lexical ranking algorithm:

- **Tokenization** — lowercased, punctuation-stripped, stop-word filtered
- **IDF (Inverse Document Frequency)** — computed across all 47 chunks at index time
- **BM25 scoring** — `k1 = 1.5`, `b = 0.75`, scores normalized to 0–1 range
- **Top-k retrieval** — returns the 5 highest-scoring chunks per query

> **Transparency note:** The interview brief asked for "vector embeddings / semantic search". This implementation uses BM25 (lexical/keyword matching) instead of true vector embeddings. BM25 was chosen as a pragmatic first implementation that works well for structured event data with predictable vocabulary. A production system would benefit from a vector store (e.g. Pinecone, Weaviate, pgvector) for semantic matching across paraphrases and synonyms.

### Knowledge Base — 47 Chunks

| Source File | Records | Description |
|---|---|---|
| `event_schedule.csv` | 14 sessions | Full day schedule — keynotes, panels, workshops, breaks |
| `speaker_directory.csv` | 7 speakers | Speaker bios, topics, organisations |
| `attendance_policies.json` | 26 policy rules | Registration, cancellation, dietary, accessibility, code of conduct, emergency procedures, data protection |

All data is **fictional/synthetic**, created specifically for this demo.

### API Routes

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Main chat — accepts `{ query, messages }`, returns SSE stream |
| `/api/documents` | GET | Lists indexed documents with record counts and previews |
| `/api/health` | GET | Returns index status and total chunk count |

### Chat Route (`app/api/chat/route.ts`)

- Receives the user query + last 6 messages of conversation history
- Calls the LLM to transform the query for retrieval
- Retrieves top-5 BM25 results from the in-memory index
- If best score < `MIN_RELEVANCE_THRESHOLD` (0.30), responds with "I don't have enough information"
- Otherwise, sends retrieved context + conversation history to the LLM for grounded generation
- Streams the response token-by-token via Server-Sent Events

---

## Tech Stack

- **Next.js 16** (App Router, React 19)
- **TypeScript**
- **Tailwind CSS** with CSS variables for theming
- **Framer Motion** for chat animations
- **LLM** — RouteLLM API (OpenAI-compatible, model: `gpt-5.4-mini`)
- **Fonts** — DM Sans (body), Plus Jakarta Sans (headings), JetBrains Mono (code/citations)

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── chat/route.ts          # Main RAG chat endpoint (SSE streaming)
│   │   ├── documents/route.ts     # Knowledge base listing
│   │   └── health/route.ts        # Index health check
│   ├── globals.css                # Tailwind + custom theme variables
│   ├── layout.tsx                 # Root layout with fonts and providers
│   └── page.tsx                   # Entry point → ChatApp component
├── components/
│   ├── chat-app.tsx               # Main chat UI (519 lines)
│   ├── theme-provider.tsx         # next-themes wrapper
│   ├── chunk-load-error-handler.tsx
│   └── ui/sonner.tsx              # Toast notifications
├── data/
│   ├── event_schedule.csv         # 14 summit sessions
│   ├── speaker_directory.csv      # 7 speaker profiles
│   └── attendance_policies.json   # 26 policy rules across 7 categories
├── lib/
│   ├── rag-engine.ts              # BM25 retrieval engine (core logic)
│   └── utils.ts                   # Tailwind merge utility
├── public/
│   └── favicon.svg                # EPA branded favicon
├── .env.example                   # Required environment variables
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## Setup

```bash
# 1. Clone
git clone https://github.com/irontrigirl/Event-Preparation-Assistant-RAG.git
cd Event-Preparation-Assistant-RAG

# 2. Install dependencies
yarn install

# 3. Create .env from template
cp .env.example .env
# Fill in ABACUSAI_API_KEY (or any OpenAI-compatible API key)

# 4. Run dev server
yarn dev
```

The app will be available at `http://localhost:3000`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ABACUSAI_API_KEY` | Yes | API key for the LLM endpoint (RouteLLM / OpenAI-compatible) |
| `DATABASE_URL` | No | PostgreSQL connection string (only if adding persistence) |

---

## Part 2 — Agent Pipeline

The companion **Part 2** project (autonomous agent pipeline for attendee verification) is in a separate repository. It demonstrates a 6-step data pipeline: Extract → Normalize → Deduplicate → Verify → Flag → Output.

---

*Built for the BeaconComms technical interview — October 2026*
