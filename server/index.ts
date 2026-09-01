import { createApp } from './app';

const { server } = createApp();
server.on('error', (error) => { console.error(`SemanticSpy could not start: ${error.message}`); process.exitCode = 1; });
server.listen(4310, '127.0.0.1', () => console.log('SemanticSpy local server: http://127.0.0.1:4310'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
