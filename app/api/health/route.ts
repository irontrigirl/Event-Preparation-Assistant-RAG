export const dynamic = 'force-dynamic';

import { initializeRAG, getTotalChunks, isInitialized } from '@/lib/rag-engine';

export async function GET() {
  try {
    await initializeRAG();
    return Response.json({
      status: 'ok',
      documents_loaded: 3,
      total_chunks: getTotalChunks(),
      initialized: isInitialized(),
    });
  } catch (error: any) {
    return Response.json(
      { status: 'error', message: error?.message ?? 'Failed to initialize RAG engine' },
      { status: 500 }
    );
  }
}
