import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AnalyticsDatabase } from '../server/src/db';
import { IngestionService } from '../server/src/ingest';
import { tempDbPath } from './helpers';

/**
 * Point REAL_SAMPLE_JSONL at any single-session .jsonl file to validate
 * that the ingestion pipeline's deduplication matches a manual count.
 *
 *   REAL_SAMPLE_JSONL=/path/to/session.jsonl npm test
 */
const REAL_SAMPLE = process.env.REAL_SAMPLE_JSONL ?? '';

describe('real sample validation', () => {
  it('matches manual request-deduped totals for a real session sample when the file exists', () => {
    if (!REAL_SAMPLE || !fs.existsSync(REAL_SAMPLE)) {
      return;
    }

    const sessionId = path.basename(REAL_SAMPLE, '.jsonl');
    const projectDir = path.basename(path.dirname(REAL_SAMPLE));

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-real-sample-'));
    const targetProjectDir = path.join(tempRoot, projectDir);
    fs.mkdirSync(targetProjectDir, { recursive: true });
    fs.copyFileSync(REAL_SAMPLE, path.join(targetProjectDir, path.basename(REAL_SAMPLE)));

    const lines = fs
      .readFileSync(REAL_SAMPLE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as any)
      .filter((line) => line.type === 'assistant' && line.message?.usage);

    const deduped = new Map<string, any>();
    for (const line of lines) {
      const key = line.requestId ?? line.message?.id ?? line.uuid;
      deduped.set(key, line);
    }

    const expected = [...deduped.values()].reduce(
      (totals, line) => {
        totals.inputTokens += line.message.usage.input_tokens ?? 0;
        totals.outputTokens += line.message.usage.output_tokens ?? 0;
        totals.cacheCreationTokens += line.message.usage.cache_creation_input_tokens ?? 0;
        totals.cacheReadTokens += line.message.usage.cache_read_input_tokens ?? 0;
        totals.totalTokens +=
          (line.message.usage.input_tokens ?? 0) +
          (line.message.usage.output_tokens ?? 0) +
          (line.message.usage.cache_creation_input_tokens ?? 0) +
          (line.message.usage.cache_read_input_tokens ?? 0);
        return totals;
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
      },
    );

    const database = new AnalyticsDatabase(tempDbPath('real-sample'));
    const ingestion = new IngestionService(database, tempRoot);
    ingestion.scan();

    const row = database.db
      .prepare('SELECT token_breakdown_top_level_json AS topLevelJson FROM session_rollups WHERE session_id = ?')
      .get(sessionId) as { topLevelJson: string };

    expect(JSON.parse(row.topLevelJson)).toEqual(expected);
    database.close();
  });
});
