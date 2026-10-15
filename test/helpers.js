import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { DEMO_EVENT_ID } from '../src/seed.js';

export const EVENT = DEMO_EVENT_ID;

const STEP_MS = 100;

/**
 * Boots the mock on an ephemeral port with a manual clock. Nothing runs on real
 * timers: `elapse(ms)` moves the clock forward and runs each background loop
 * whenever its period comes due, exactly as main.js would.
 * @param {{ env?: Record<string, string>, randomInt?: (maxExclusive: number) => number, startAt?: number }} [options]
 */
export async function startMock({ env = {}, randomInt, startAt = Date.UTC(2026, 8, 20, 10, 0, 0) } = {}) {
  let now = startAt;
  const clock = { now: () => now };
  const app = createApp({ config: loadConfig(env), clock, logger: createLogger({ level: 'silent' }), randomInt });

  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const due = new Map(app.loops.map((loop) => [loop.name, now + loop.everyMs]));

  const mock = {
    services: app.services,
    clock,

    // Moves the clock without running any loop (e.g. to let a hold lapse unswept).
    advance(ms) {
      now += ms;
      for (const loop of app.loops) due.set(loop.name, Math.max(due.get(loop.name), now));
    },

    elapse(ms) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(now + STEP_MS, end);
        for (const loop of app.loops) {
          if (now >= due.get(loop.name)) {
            loop.run();
            due.set(loop.name, now + loop.everyMs);
          }
        }
      }
    },

    runLoop(name) {
      const loop = app.loops.find((l) => l.name === name);
      if (!loop) throw new Error(`No background loop named "${name}"`);
      loop.run();
    },

    /**
     * @param {string} method
     * @param {string} path
     * @param {{ account?: string, token?: string, key?: string, body?: unknown, rawBody?: string, headers?: Record<string, string> }} [options]
     * @returns {Promise<{ status: number, headers: Headers, body: any }>}
     */
    async call(method, path, { account, token, key, body, rawBody, headers = {} } = {}) {
      const all = { ...headers };
      if (account) all['X-Account-Id'] = account;
      if (token) all.Authorization = `Bearer ${token}`;
      if (key) all['Idempotency-Key'] = key;
      if (body !== undefined || rawBody !== undefined) all['Content-Type'] = 'application/json';
      const res = await fetch(base + path, { method, headers: all, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text === '' ? null : JSON.parse(text) };
    },

    // Joins the queue and runs the loops until the account is admitted.
    async admit(account, eventId = EVENT) {
      const joined = await mock.call('POST', `/events/${eventId}/queue`, { account });
      if (joined.status !== 201 && joined.status !== 200) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
      for (let i = 0; i < 30; i++) {
        mock.elapse(1000);
        const status = await mock.call('GET', `/events/${eventId}/queue/me`, { account });
        if (status.body.state === 'admitted') return status.body.admissionToken;
      }
      throw new Error(`${account} was not admitted within 30 simulated seconds`);
    },

    close: () => new Promise((resolve) => server.close(resolve)),
  };
  return mock;
}
