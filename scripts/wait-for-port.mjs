import net from 'node:net';

const port = Number(process.argv[2] ?? 3001);
const host = process.argv[3] ?? '127.0.0.1';
const timeoutMs = Number(process.argv[4] ?? 60_000);
const intervalMs = 250;
const startedAt = Date.now();

function waitForPort() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    socket.once('connect', () => {
      socket.end();
      resolve();
    });

    socket.once('error', () => {
      socket.destroy();
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${host}:${port}`));
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
