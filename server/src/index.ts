import fs from 'node:fs';
import path from 'node:path';

import { buildApp } from './app.js';
import { DEFAULT_PORT } from './config.js';

const PORT_FILE = path.join(process.cwd(), '.data', '.port');
const MAX_RETRIES = 10;

const app = await buildApp();

let port = DEFAULT_PORT;
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    await app.listen({ host: '0.0.0.0', port });
    break;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      port++;
      continue;
    }
    console.error(error);
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true });
fs.writeFileSync(PORT_FILE, String(port));
console.log(`Claude Session Analytics listening on http://localhost:${port}`);
