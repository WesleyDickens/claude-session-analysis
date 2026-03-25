import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const PORT_FILE = path.join(process.cwd(), '.data', '.port');
const timeoutMs = Number(process.argv[2] ?? 60_000);
const intervalMs = 250;
const startedAt = Date.now();

function readPort() {
  try {
    return Number(fs.readFileSync(PORT_FILE, 'utf-8').trim());
  } catch {
    return null;
  }
}

function waitForPort() {
  return new Promise((resolve, reject) => {
    const port = readPort();
    if (!port) {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for server to write port file`));
        return;
      }
      setTimeout(() => {
        waitForPort().then(resolve).catch(reject);
      }, intervalMs);
      return;
    }

    const socket = net.createConnection({ host: '127.0.0.1', port });

    socket.once('connect', () => {
      socket.end();
      resolve();
    });

    socket.once('error', () => {
      socket.destroy();
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for 127.0.0.1:${port}`));
        return;
      }
      setTimeout(() => {
        waitForPort().then(resolve).catch(reject);
      }, intervalMs);
    });
  });
}

waitForPort()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
