import { createServer } from 'node:http';
import { DxApiRouter } from './DxApiRouter.js';

/** Starts the mock on MOCK_PORT (default 3333), bound to localhost. */
class MockServer {
  static start(port = Number(process.env.MOCK_PORT ?? 3333), host = process.env.MOCK_HOST ?? '127.0.0.1'): void {
    const server = createServer((req, res) => void DxApiRouter.handle(req, res));
    server.listen(port, host, () => {
      console.log(`mock DX API v2 listening on ${host}:${port}`);
    });
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}

MockServer.start();
