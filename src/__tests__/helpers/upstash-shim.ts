/**
 * A wire-faithful Upstash REST shim, so the sponsorship path can be tested
 * against the REAL @upstash/redis client instead of a hand-rolled fake.
 *
 * Why it exists: the budget path's four historical defects all lived in the
 * gap between "what the fake store did" and "what Upstash does" — and the
 * client's own behavior (auto-pipelining ON by default, base64 response
 * encoding, per-element errors inside an HTTP 200, UpstashError throws the
 * fake never modeled) is part of that gap. This speaks exactly the protocol
 * the installed client (v1.35.x) sends: POST /pipeline with a JSON array of
 * command arrays, responses as an aligned array of {result}|{error}, string
 * results base64-encoded because the client always sends
 * `Upstash-Encoding: base64` ("OK" travels literally; numbers and null raw —
 * not honoring this silently corrupts any stored value that happens to be
 * valid base64).
 *
 * Redis semantics reproduced for the commands the path uses: values stored
 * as strings; INCR/DECR create missing keys at 1/-1 WITH NO EXPIRY; TTL is
 * -2 missing, -1 no expiry, else rounded seconds; SET supports EX and NX;
 * plain SET clears a TTL; lazy expiry against a CONTROLLABLE clock so no
 * test ever sleeps. Unknown commands (the rate limiter's EVAL) get a
 * per-element error, which the caller's fail-open path is expected to eat.
 */
import { createServer, type Server } from 'node:http';

interface Entry {
  value: string;
  expiresAt: number | null;
}

export interface UpstashShim {
  url: string;
  token: string;
  store: Map<string, Entry>;
  clock: { now: number };
  advance(ms: number): void;
  /** One-shot synchronous hook run just before the matching command executes —
   *  how a test moves the clock between a handler's GET and its DECR. */
  before(cmd: string, key: string, fn: () => void): void;
  /** Every request body received, oldest first. */
  requests: unknown[][];
  /** Count of commands whose name matches, across all requests. */
  commandCount(cmd: string, keyIncludes?: string): number;
  close(): Promise<void>;
}

export async function startUpstashShim(): Promise<UpstashShim> {
  const store = new Map<string, Entry>();
  const clock = { now: 1_750_000_000_000 };
  const hooks = new Map<string, () => void>();
  const requests: unknown[][] = [];
  const token = 'shim-test-token';

  const expired = (e: Entry) => e.expiresAt !== null && e.expiresAt <= clock.now;
  const live = (key: string): Entry | undefined => {
    const e = store.get(key);
    if (!e) return undefined;
    if (expired(e)) {
      store.delete(key);
      return undefined;
    }
    return e;
  };

  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

  function run(cmdArr: unknown[]): { result?: unknown; error?: string } {
    const [cmdRaw, ...args] = cmdArr as [string, ...unknown[]];
    const cmd = String(cmdRaw).toLowerCase();
    const key = String(args[0] ?? '');

    const hookId = `${cmd}:${key}`;
    const hook = hooks.get(hookId);
    if (hook) {
      hooks.delete(hookId);
      hook();
    }

    switch (cmd) {
      case 'ping':
        return { result: 'PONG' };
      case 'set': {
        const value = String(args[1]);
        let ex: number | null = null;
        let nx = false;
        for (let i = 2; i < args.length; i++) {
          const flag = String(args[i]).toLowerCase();
          if (flag === 'ex') ex = Number(args[++i]);
          else if (flag === 'nx') nx = true;
        }
        if (nx && live(key)) return { result: null };
        store.set(key, { value, expiresAt: ex !== null ? clock.now + ex * 1000 : null });
        return { result: 'OK' };
      }
      case 'get': {
        const e = live(key);
        return { result: e ? b64(e.value) : null };
      }
      case 'incr':
      case 'decr': {
        const delta = cmd === 'incr' ? 1 : -1;
        const e = live(key);
        if (!e) {
          store.set(key, { value: String(delta), expiresAt: null });
          return { result: delta };
        }
        if (!/^-?\d+$/.test(e.value)) {
          return { error: 'ERR value is not an integer or out of range' };
        }
        e.value = String(parseInt(e.value, 10) + delta);
        return { result: parseInt(e.value, 10) };
      }
      case 'ttl': {
        const e = live(key);
        if (!e) return { result: -2 };
        if (e.expiresAt === null) return { result: -1 };
        return { result: Math.floor((e.expiresAt - clock.now + 500) / 1000) };
      }
      case 'expire': {
        const e = live(key);
        if (!e) return { result: 0 };
        e.expiresAt = clock.now + Number(args[1]) * 1000;
        return { result: 1 };
      }
      case 'del': {
        let n = 0;
        for (const k of cmdArr.slice(1)) if (store.delete(String(k))) n++;
        return { result: n };
      }
      default:
        // The rate limiter's EVAL lands here; its caller fails open.
        return { error: `ERR unknown command '${cmd}'` };
    }
  }

  const server: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url?.startsWith('/pipeline')) {
        const cmds = parsed as unknown[][];
        requests.push(...cmds.map((c) => c as unknown[]));
        return res.end(JSON.stringify(cmds.map(run)));
      }
      requests.push(parsed as unknown[]);
      return res.end(JSON.stringify(run(parsed as unknown[])));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');

  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    store,
    clock,
    advance: (ms) => {
      clock.now += ms;
    },
    before: (cmd, key, fn) => {
      hooks.set(`${cmd.toLowerCase()}:${key}`, fn);
    },
    requests,
    commandCount: (cmd, keyIncludes) =>
      requests.filter(
        (c) =>
          String(c[0]).toLowerCase() === cmd.toLowerCase() &&
          (keyIncludes === undefined || String(c[1] ?? '').includes(keyIncludes))
      ).length,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface MockUpstream {
  url: string;
  mode: { current: 'ok' | 'rpcError' | 'http500' | 'die' };
  requests: unknown[];
  close(): Promise<void>;
}

/** The upstream ERC-7677 paymaster the proxy forwards to. */
export async function startMockUpstream(): Promise<MockUpstream> {
  const mode: MockUpstream['mode'] = { current: 'ok' };
  const requests: unknown[] = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push(parsed);
      switch (mode.current) {
        case 'die':
          return req.socket.destroy();
        case 'http500':
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: -32000, message: 'upstream 500' } }));
        case 'rpcError':
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, error: { code: -32001, message: 'policy says no' } })
          );
        case 'ok':
        default:
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? null,
              result: { paymaster: '0x' + '42'.repeat(20), paymasterData: '0x1234' },
            })
          );
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no address');

  return {
    url: `http://127.0.0.1:${address.port}`,
    mode,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
