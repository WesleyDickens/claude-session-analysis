import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../server/src/app';
import { FIXTURE_ROOT, tempDbPath } from './helpers';

describe('API integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({
      dataRoot: FIXTURE_ROOT,
      dbPath: tempDbPath('api'),
      autoScan: true,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns filters from the indexed dataset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/filters',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.projects).toContain('sample');
    expect(payload.projects).toContain('other');
    expect(payload.tools).toContain('Write');
    expect(payload.tools).toContain('Bash');
  });

  it('supports project, tool, and date filtering for sessions and overview queries', async () => {
    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions?projects=sample&tools=Write&tokenMode=rolled_up',
    });

    expect(sessionsResponse.statusCode).toBe(200);
    const sessionsPayload = sessionsResponse.json();
    expect(sessionsPayload.total).toBe(1);
    expect(sessionsPayload.items[0].sessionId).toBe('aaaaaaaa-1111-2222-3333-444444444444');

    const overviewResponse = await app.inject({
      method: 'GET',
      url: '/api/overview?dateFrom=2026-03-24&dateTo=2026-03-25&tokenMode=rolled_up',
    });

    expect(overviewResponse.statusCode).toBe(200);
    const overviewPayload = overviewResponse.json();
    expect(overviewPayload.kpis.totalSessions).toBe(2);
    expect(overviewPayload.tokenTrend.map((bucket: { bucket: string }) => bucket.bucket)).toEqual(['2026-03-24', '2026-03-25']);
  });

  it('recomputes spend-style overview metrics for selected token types', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/overview?dateFrom=2026-03-24&dateTo=2026-03-25&tokenMode=rolled_up&tokenTypes=outputTokens,cacheReadTokens',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();

    expect(payload.kpis.medianSessionCost).toBe(126);
    expect(payload.sessionScatter.map((row: { totalTokens: number }) => row.totalTokens).sort((left: number, right: number) => left - right)).toEqual([39, 212]);
  });

  it('supports hourly, weekly, and monthly token-trend bucketing', async () => {
    const hourlyResponse = await app.inject({
      method: 'GET',
      url: '/api/overview?dateFrom=2026-03-24&dateTo=2026-03-25&timeGranularity=hourly',
    });
    const weeklyResponse = await app.inject({
      method: 'GET',
      url: '/api/overview?dateFrom=2026-03-24&dateTo=2026-03-25&timeGranularity=weekly',
    });
    const monthlyResponse = await app.inject({
      method: 'GET',
      url: '/api/overview?dateFrom=2026-03-24&dateTo=2026-03-25&timeGranularity=monthly',
    });

    expect(hourlyResponse.statusCode).toBe(200);
    expect(weeklyResponse.statusCode).toBe(200);
    expect(monthlyResponse.statusCode).toBe(200);

    const hourlyPayload = hourlyResponse.json();
    const weeklyPayload = weeklyResponse.json();
    const monthlyPayload = monthlyResponse.json();

    expect(hourlyPayload.tokenTrend.map((bucket: { bucket: string }) => bucket.bucket)).toEqual([
      '2026-03-24 6 AM',
      '2026-03-25 4 AM',
    ]);
    expect(hourlyPayload.tokenTrend.map((bucket: { bucket: string }) => bucket.bucket)).not.toContain('2026-03-24 11 PM');
    expect(weeklyPayload.tokenTrend).toHaveLength(1);
    expect(weeklyPayload.tokenTrend[0].bucket).toMatch(/^2026-W\d{2}$/);
    expect(monthlyPayload.tokenTrend.map((bucket: { bucket: string }) => bucket.bucket)).toEqual(['2026-03']);
  });

  it('supports pagination and sorting stability', async () => {
    const pageOne = await app.inject({
      method: 'GET',
      url: '/api/sessions?sortBy=totalTokens&sortDir=desc&page=1&pageSize=1&tokenMode=rolled_up',
    });
    const pageTwo = await app.inject({
      method: 'GET',
      url: '/api/sessions?sortBy=totalTokens&sortDir=desc&page=2&pageSize=1&tokenMode=rolled_up',
    });

    expect(pageOne.statusCode).toBe(200);
    expect(pageTwo.statusCode).toBe(200);

    const first = pageOne.json();
    const second = pageTwo.json();

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0].sessionId).toBe('aaaaaaaa-1111-2222-3333-444444444444');
    expect(second.items[0].sessionId).not.toBe(first.items[0].sessionId);
  });
});
