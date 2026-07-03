import type { Response } from 'express';
import type { SseEvent } from '../types.js';

const clients = new Set<Response>();

export function addClient(res: Response): () => void {
  clients.add(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);
  const remove = () => {
    clearInterval(heartbeat);
    clients.delete(res);
  };
  res.on('close', remove);
  return remove;
}

export function broadcast(event: SseEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}
