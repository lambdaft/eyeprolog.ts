// Browser worker entry used by playground.html.
// Keep this module free of Node-only imports: it is fetched directly by the
// browser and is also exercised by test/run-playground.mjs.
// @ts-expect-error TS2307: auto-suppressed
import { createEyePrologRegistry, run } from './index.js?playground=20260811c';

const registry = createEyePrologRegistry();

export function executePlaygroundRequest(data: any, now: any = defaultNow): any {
  const started = now();
  try {
    const result = run(data?.source ?? '', {
      ...(data?.options ?? {}),
      registry,
    });
    return {
      ok: true,
      stdout: result.stdout,
      stats: result.stats,
      haltCode: result.haltCode,
      elapsedMs: Math.max(0, now() - started),
    };
  } catch (error) {
    return {
      ok: false,
      // @ts-expect-error TS2339: auto-suppressed
      code: error?.code,
      // @ts-expect-error TS2339: auto-suppressed
      stdout: error?.stdout,
      // @ts-expect-error TS2339: auto-suppressed
      error: error?.stack || error?.message || String(error),
    };
  }
}

export function installPlaygroundWorker(scope: any): any {
  scope.onmessage = (event: any) => {
    scope.postMessage(executePlaygroundRequest(event.data));
  };
}

function defaultNow(): any {
  return globalThis.performance?.now?.() ?? Date.now();
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  installPlaygroundWorker(self);
  self.postMessage({ type: 'ready' });
}
