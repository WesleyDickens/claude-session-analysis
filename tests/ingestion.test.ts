import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AnalyticsDatabase } from '../server/src/db';
import { IngestionService } from '../server/src/ingest';
import { FIXTURE_ROOT, tempDbPath } from './helpers';

describe('ingestion pipeline', () => {
  it('deduplicates assistant request rows and rolls subagents into parent totals', () => {
    const database = new AnalyticsDatabase(tempDbPath('ingestion'));
    const ingestion = new IngestionService(database, FIXTURE_ROOT);

    const summary = ingestion.scan();
    expect(summary.errors).toEqual([]);
    expect(summary.filesScanned).toBeGreaterThanOrEqual(4);

    const row = database.db
      .prepare(
        `
          SELECT
            token_breakdown_top_level_json AS topLevelJson,
            token_breakdown_rolled_up_json AS rolledUpJson,
            subagent_count AS subagentCount,
            anomaly_badges_rolled_up_json AS rolledBadgesJson
          FROM session_rollups
          WHERE session_id = ?
        `,
      )
      .get('aaaaaaaa-1111-2222-3333-444444444444') as {
      topLevelJson: string;
      rolledUpJson: string;
      subagentCount: number;
      rolledBadgesJson: string;
    };

    const topLevel = JSON.parse(row.topLevelJson) as { totalTokens: number; inputTokens: number; outputTokens: number };
    const rolledUp = JSON.parse(row.rolledUpJson) as { totalTokens: number };

    expect(topLevel).toMatchObject({
      inputTokens: 18,
      outputTokens: 32,
      totalTokens: 300,
    });
    expect(rolledUp.totalTokens).toBe(460);
    expect(row.subagentCount).toBe(1);
    expect(JSON.parse(row.rolledBadgesJson)).toContain('Subagent-heavy');

    const requestCount = database.db
      .prepare('SELECT COUNT(*) AS total FROM requests WHERE session_id = ?')
      .get('aaaaaaaa-1111-2222-3333-444444444444') as { total: number };
    expect(requestCount.total).toBe(3);

    const toolCall = database.db
      .prepare('SELECT result_content AS resultContent FROM tool_calls WHERE tool_use_id = ?')
      .get('toolu_a_1') as { resultContent: string };
    expect(toolCall.resultContent).toBe('ok');

    database.close();
  });

  it('proves raw assistant-row summation overcounts compared with canonical request grouping', () => {
    const filePath = path.join(
      FIXTURE_ROOT,
      '-Users-demo-sample',
      'aaaaaaaa-1111-2222-3333-444444444444.jsonl',
    );
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as any);

    const rawAssistantOutput = lines
      .filter((line) => line.type === 'assistant')
      .reduce((total, line) => total + (line.message?.usage?.output_tokens ?? 0), 0);

    const groupedByRequest = new Map<string, any>();
    for (const line of lines.filter((entry) => entry.type === 'assistant')) {
      const key = line.requestId ?? line.message?.id ?? line.uuid;
      groupedByRequest.set(key, line);
    }
    const dedupedOutput = [...groupedByRequest.values()].reduce(
      (total, line) => total + (line.message?.usage?.output_tokens ?? 0),
      0,
    );

    expect(rawAssistantOutput).toBe(42);
    expect(dedupedOutput).toBe(32);
    expect(rawAssistantOutput).toBeGreaterThan(dedupedOutput);
  });
});
