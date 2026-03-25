import path from 'node:path';
import fs from 'node:fs';

import cors from '@fastify/cors';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import { DEFAULT_DATA_ROOT, DEFAULT_DB_PATH } from './config.js';
import { AnalyticsDatabase } from './db.js';
import { AnalyticsService } from './analytics.js';
import { IngestionService } from './ingest.js';
import type { SessionQuery, TimeGranularity, TokenTypeKey } from '../../shared/contracts.js';

type AppOptions = {
  dataRoot?: string;
  dbPath?: string;
  autoScan?: boolean;
};

export async function buildApp(options: AppOptions = {}) {
  const app = fastify({ logger: false });
  const database = new AnalyticsDatabase(options.dbPath ?? DEFAULT_DB_PATH);
  const analytics = new AnalyticsService(database);
  const ingestion = new IngestionService(database, options.dataRoot ?? DEFAULT_DATA_ROOT);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed'), false);
      }
    },
  });

  if (options.autoScan !== false) {
    ingestion.scan();
  }

  app.decorate('services', {
    database,
    analytics,
    ingestion,
  });

  app.get('/api/health', async () => ({ ok: true }));
  app.post('/api/scan', async () => ingestion.scan());
  app.get('/api/filters', async () => analytics.getFilters());
  app.get('/api/overview', async (request) => analytics.getOverview(parseSessionQuery(request.query as Record<string, unknown>)));
  app.get('/api/sessions', async (request) => analytics.getSessions(parseSessionQuery(request.query as Record<string, unknown>)));
  app.get('/api/sessions/:id', async (request) => analytics.getSessionDetail((request.params as { id: string }).id));
  app.get('/api/sessions/:id/requests', async (request) => {
    const params = request.params as { id: string };
    const query = parseSessionQuery(request.query as Record<string, unknown>);
    return analytics.getSessionRequests(params.id, query.tokenMode ?? 'rolled_up', query.dateFrom, query.dateTo);
  });

  const clientDist = path.join(process.cwd(), 'dist', 'public');
  if (fs.existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url?.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    if (fs.existsSync(path.join(clientDist, 'index.html'))) {
      return reply.sendFile('index.html');
    }
    reply.code(404).send({ error: 'Frontend assets not found. Run the Vite dev server or build the app.' });
  });

  app.addHook('onClose', async () => {
    database.close();
  });

  return app;
}

const VALID_TOKEN_TYPES = new Set<TokenTypeKey>(['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens']);
const VALID_TIME_GRANULARITIES = new Set<TimeGranularity>(['hourly', 'daily', 'weekly', 'monthly']);

function parseSessionQuery(query: Record<string, unknown>): SessionQuery {
  const toArray = (value: unknown) => {
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const tokenMode = query.tokenMode === 'top_level_only' ? 'top_level_only' : 'rolled_up';
  const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';
  const tokenTypes = toArray(query.tokenTypes)?.filter((value): value is TokenTypeKey => VALID_TOKEN_TYPES.has(value as TokenTypeKey));
  const timeGranularity = VALID_TIME_GRANULARITIES.has(query.timeGranularity as TimeGranularity)
    ? (query.timeGranularity as TimeGranularity)
    : undefined;

  return {
    projects: toArray(query.projects),
    models: toArray(query.models),
    versions: toArray(query.versions),
    branches: toArray(query.branches),
    tools: toArray(query.tools),
    tokenTypes: tokenTypes?.length ? tokenTypes : undefined,
    timeGranularity,
    dateFrom: typeof query.dateFrom === 'string' ? query.dateFrom : undefined,
    dateTo: typeof query.dateTo === 'string' ? query.dateTo : undefined,
    sessionSearch: typeof query.sessionSearch === 'string' ? query.sessionSearch : undefined,
    tokenMode,
    page: typeof query.page === 'string' ? Number(query.page) : undefined,
    pageSize: typeof query.pageSize === 'string' ? Number(query.pageSize) : undefined,
    sortBy: typeof query.sortBy === 'string' ? query.sortBy : undefined,
    sortDir,
  } as const;
}
