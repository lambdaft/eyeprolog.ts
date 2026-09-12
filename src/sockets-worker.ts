import net from 'node:net';
import os from 'node:os';
import { parentPort, workerData } from 'node:worker_threads';

const HEADER_WORDS = 4;
const header = new Int32Array(workerData.shared, 0, HEADER_WORDS);
const bytes = new Uint8Array(workerData.shared, HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

let nextServerId = 1;
let nextConnectionId = 1;
const servers: Map<any, any> = new Map();
const connections: Map<any, any> = new Map();

function errorRecord(error: any): any {
  return {
    code: String(error?.code ?? 'EUNKNOWN'),
    message: String(error?.message ?? error ?? 'socket error'),
  };
}

function writeResponse(response: any): any {
  const encoded = encoder.encode(JSON.stringify(response));
  if (encoded.length > bytes.length) {
    const fallback = encoder.encode(JSON.stringify({ ok: false, error: { code: 'EMSGSIZE', message: 'socket response too large' } }));
    bytes.set(fallback.subarray(0, bytes.length), 0);
    Atomics.store(header, 2, Math.min(fallback.length, bytes.length));
  } else {
    bytes.set(encoded, 0);
    Atomics.store(header, 2, encoded.length);
  }
  Atomics.store(header, 0, 2);
  Atomics.notify(header, 0, 1);
}

function takeBuffered(state: any, maxBytes: any): any {
  if (state.chunks.length === 0) return null;
  const first = state.chunks[0];
  if (first.length <= maxBytes) {
    state.chunks.shift();
    return first;
  }
  const result = first.subarray(0, maxBytes);
  state.chunks[0] = first.subarray(maxBytes);
  return result;
}

function satisfyReaders(state: any): any {
  while (state.readers.length > 0) {
    const waiter = state.readers[0];
    if (state.error) {
      state.readers.shift();
      waiter.reject(state.error);
      continue;
    }
    const chunk = takeBuffered(state, waiter.maxBytes);
    if (chunk != null) {
      state.readers.shift();
      waiter.resolve(chunk);
      continue;
    }
    if (state.ended) {
      state.readers.shift();
      waiter.resolve(null);
      continue;
    }
    break;
  }
}

function registerConnection(socket: any): any {
  const id = nextConnectionId++;
  const state = { id, socket, chunks: [], readers: [], ended: false, error: null };
  connections.set(id, state);
  socket.on('data', (chunk: any) => {
    (state.chunks as any[]).push(Buffer.from(chunk) as any);
    satisfyReaders(state);
  });
  socket.on('end', () => {
    state.ended = true;
    satisfyReaders(state);
  });
  socket.on('close', () => {
    state.ended = true;
    satisfyReaders(state);
  });
  socket.on('error', (error: any) => {
    state.error = error;
    satisfyReaders(state);
  });
  return state;
}

function connectionClient(socket: any): any {
  const address = socket.remoteAddress ?? '';
  const port = socket.remotePort ?? 0;
  return address.includes(':') && !address.startsWith('[')
    ? `[${address}]:${port}`
    : `${address}:${port}`;
}

function queueAccepted(serverState: any, socket: any): any {
  const connection = registerConnection(socket);
  const accepted = { connectionId: connection.id, client: connectionClient(socket) };
  const waiter = serverState.acceptors.shift();
  if (waiter) waiter.resolve(accepted);
  else serverState.accepted.push(accepted);
}

async function serverOpen(host: any, port: any): Promise<any> {
  const server = net.createServer();
  const state = { id: nextServerId++, server, accepted: [], acceptors: [], closed: false };
  server.on('connection', (socket: any) => queueAccepted(state, socket));
  await new Promise((resolve: any, reject: any) => {
    const onError = (error: any) => { server.off('listening', onListen); reject(error); };
    const onListen = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen({ host, port });
  });
  const address = server.address();
  servers.set(state.id, state);
  return { serverId: state.id, port: typeof address === 'object' && address ? address.port : port };
}

async function clientOpen(host: any, port: any): Promise<any> {
  const socket = new net.Socket();
  const state = registerConnection(socket);
  try {
    await new Promise((resolve: any, reject: any) => {
      const onConnect = () => { socket.off('error', onError); resolve(); };
      const onError = (error: any) => { socket.off('connect', onConnect); reject(error); };
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.connect({ host, port });
    });
  } catch (error: any) {
    connections.delete(state.id);
    socket.destroy();
    throw error;
  }
  return { connectionId: state.id };
}

async function serverAccept(serverId: any): Promise<any> {
  const state = servers.get(serverId);
  if (!state || state.closed) throw Object.assign(new Error('server socket is closed'), { code: 'EBADF' });
  if (state.accepted.length > 0) return state.accepted.shift();
  return new Promise((resolve: any, reject: any) => state.acceptors.push({ resolve, reject }));
}

function serverClose(serverId: any): any {
  const state = servers.get(serverId);
  if (!state || state.closed) throw Object.assign(new Error('server socket does not exist'), { code: 'EBADF' });
  state.closed = true;
  for (const waiter of state.acceptors.splice(0)) {
    waiter.reject(Object.assign(new Error('server socket is closed'), { code: 'EBADF' }));
  }
  try { state.server.close(); } catch (_) { /* already closed */ }
  servers.delete(serverId);
  return {};
}

async function connectionRead(connectionId: any, maxBytes: any): Promise<any> {
  const state = connections.get(connectionId);
  if (!state) throw Object.assign(new Error('socket stream does not exist'), { code: 'EBADF' });
  if (state.error) throw state.error;
  const chunk = takeBuffered(state, maxBytes);
  if (chunk != null) return { eof: false, data: chunk.toString('base64') };
  if (state.ended) return { eof: true, data: '' };
  const result = await new Promise((resolve: any, reject: any) => state.readers.push({ maxBytes, resolve, reject }));
  return result == null ? { eof: true, data: '' } : { eof: false, data: (result as any).toString('base64') };
}

async function connectionWrite(connectionId: any, base64: any): Promise<any> {
  const state = connections.get(connectionId);
  if (!state || state.ended) throw Object.assign(new Error('socket stream is closed'), { code: 'EBADF' });
  const data = Buffer.from(base64, 'base64');
  await new Promise((resolve: any, reject: any) => {
    let settled = false;
    const onError = (error: any) => {
      if (settled) return;
      settled = true;
      state.socket.off('error', onError);
      reject(error);
    };
    state.socket.once('error', onError);
    state.socket.write(data, () => {
      if (settled) return;
      settled = true;
      state.socket.off('error', onError);
      resolve();
    });
  });
  return {};
}

function connectionClose(connectionId: any): any {
  const state = connections.get(connectionId);
  if (!state) return {};
  state.ended = true;
  satisfyReaders(state);
  state.socket.destroy();
  connections.delete(connectionId);
  return {};
}

async function handle(request: any): Promise<any> {
  switch (request.op) {
    case 'hostname': return { hostname: os.hostname() };
    case 'server_open': return serverOpen(request.host, request.port);
    case 'server_accept': return serverAccept(request.serverId);
    case 'server_close': return serverClose(request.serverId);
    case 'client_open': return clientOpen(request.host, request.port);
    case 'read': return connectionRead(request.connectionId, request.maxBytes);
    case 'write': return connectionWrite(request.connectionId, request.data);
    case 'close': return connectionClose(request.connectionId);
    default: throw Object.assign(new Error(`unknown socket operation: ${request.op}`), { code: 'EINVAL' });
  }
}

parentPort?.on('message', async () => {
  if (Atomics.load(header, 0) !== 1) return;
  try {
    const length = Atomics.load(header, 1);
    const request = JSON.parse(decoder.decode(bytes.subarray(0, length)));
    writeResponse({ ok: true, result: await handle(request) });
  } catch (error: any) {
    writeResponse({ ok: false, error: errorRecord(error) });
  }
});

Atomics.store(header, 0, -1);
Atomics.notify(header, 0, 1);
