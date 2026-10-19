export const dynamic = 'force-dynamic';

import { initializeRAG, getDocumentSummaries } from '@/lib/rag-engine';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    await initializeRAG();
    const summaries = getDocumentSummaries();

    // Also load raw content for previews
    const dataDir = path.join(process.cwd(), 'data');
    const previews: Record<string, string> = {};
    try {
      previews['event_schedule.csv'] = fs.readFileSync(path.join(dataDir, 'event_schedule.csv'), 'utf-8');
      previews['speaker_directory.csv'] = fs.readFileSync(path.join(dataDir, 'speaker_directory.csv'), 'utf-8');
      previews['attendance_policies.json'] = fs.readFileSync(path.join(dataDir, 'attendance_policies.json'), 'utf-8');
    } catch {
      // previews not critical
    }

    return Response.json({ documents: summaries, previews });
  } catch (error: any) {
    return Response.json(
      { error: error?.message ?? 'Failed to load documents' },
      { status: 500 }
    );
  }
}
