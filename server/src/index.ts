import { buildApp } from './app.js';
import { DEFAULT_PORT } from './config.js';

const app = await buildApp();

try {
  await app.listen({
    host: '0.0.0.0',
    port: DEFAULT_PORT,
  });
  console.log(`Claude Session Analytics listening on http://localhost:${DEFAULT_PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
