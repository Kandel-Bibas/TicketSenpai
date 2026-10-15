import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { DEMO_EVENT_ID } from '../src/seed.js';
import { createApi } from '../web/js/api.js';
import { createCrowd } from '../web/js/crowd.js';

const EVENT = DEMO_EVENT_ID;
const STEP_MS = 100;

// startMock() in helpers.js does not expose the base URL it listens on, so the
// crowd (an HTTP client) cannot be driven against it. This is a short copy of
// helpers.js's manual-clock server boot, exposing only baseUrl/elapse/close.
async function startServer({ env = {} } = {}) {
  let now = Date.UTC(2026, 8, 20, 10, 0, 0);
  const clock = { now: () => now };
  const app = createApp({ config: loadConfig(env), clock, logger: createLogger({ level: 'silent' }) });
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const due = new Map(app.loops.map((loop) => [loop.name, now + loop.everyMs]));

  function elapse(ms) {
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
  }

  return { baseUrl, elapse, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Deterministic PRNG (LCG) so bot decisions are reproducible across runs.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Every simulated `sleep` advances the same manual clock. With many bots each
// sleeping independently, letting a single call jump the full requested amount
// (some waits are 60s) would run holds (480s) and tokens (900s) past expiry
// almost immediately. Capping each jump keeps simulated time moving without
// outrunning those TTLs; bots just re-check state sooner than they "intended" to.
function crowdSleep(elapse) {
  return async (ms) => {
    elapse(Math.min(ms, 250));
    await new Promise((resolve) => setTimeout(resolve, 1));
  };
}

async function buildCrowd(server, seed) {
  const api = createApi({ baseUrl: server.baseUrl });
  // api.js has no single-event getter; pull seatLimitPerAccount from the list instead.
  const [{ items }, seatMap] = await Promise.all([api.listEvents(), api.getSeatMap(EVENT)]);
  const event = items.find((e) => e.eventId === EVENT);
  const crowd = createCrowd({
    api,
    eventId: EVENT,
    seatMap,
    seatLimit: event.seatLimitPerAccount,
    sleep: crowdSleep(server.elapse),
    random: seededRandom(seed),
  });
  return { api, crowd };
}

test('a crowd of bots settles to terminal buckets with confirmed purchases', async () => {
  const server = await startServer();
  try {
    const { api, crowd } = await buildCrowd(server, 1);

    crowd.send(40);
    await crowd.idle();

    const stats = crowd.stats();
    const total = stats.queued + stats.shopping + stats.paying + stats.bought + stats.gaveUp + stats.failed;
    assert.equal(total, 40);
    assert.equal(stats.queued, 0);
    assert.equal(stats.shopping, 0);
    assert.equal(stats.paying, 0);
    assert.equal(stats.failed, 0, `expected no failures; lastFailure: ${crowd.lastFailure()}`);
    assert.ok(stats.bought > 0, 'expected at least one confirmed purchase');

    const dashboard = await api.dashboard(EVENT);
    assert.ok(dashboard.inventory.sold > 0);

    server.elapse(5000); // let the invariant checker (every 5s) run at least once
    const dashboard2 = await api.dashboard(EVENT);
    assert.notEqual(dashboard2.invariants.checkedAt, null);
    assert.equal(dashboard2.invariants.seatsInMultipleConfirmedOrders, 0);
    assert.equal(dashboard2.invariants.soldSeatsWithoutConfirmedOrder, 0);
    assert.equal(dashboard2.invariants.capturedPaymentsWithoutConfirmedOrder, 0);
  } finally {
    await server.close();
  }
});

test('sell-out: every bot ends up bought or legitimately gave up, none fail', async () => {
  const server = await startServer();
  try {
    const { api, crowd } = await buildCrowd(server, 2);

    crowd.send(200);
    await crowd.idle();

    const stats = crowd.stats();
    assert.equal(stats.queued + stats.shopping + stats.paying, 0);
    assert.equal(stats.failed, 0, `expected no failures; lastFailure: ${crowd.lastFailure()}`);

    server.elapse(5000); // one more invariant check, after the last sale
    const dashboard = await api.dashboard(EVENT);
    const { inventory, holds, invariants } = dashboard;
    const context = JSON.stringify({ stats, inventory, holds });

    // Demand (200 bots, 1–4 seats each) far exceeds the 270 seats: the house all but sells out,
    // bots race each other for seats, and the ones left over walk away instead of erroring.
    // Not exactly `total`: a bot that abandons its hold last can strand those seats until expiry.
    assert.ok(inventory.sold > inventory.total * 0.85, `expected a near sell-out: ${context}`);
    assert.equal(inventory.sold + inventory.held + inventory.available, inventory.total, context);
    assert.ok(holds.seatTaken > 0, `expected bots picking from the stale view to lose some races: ${context}`);
    assert.ok(stats.gaveUp > 0, `expected some bots to leave empty-handed: ${context}`);
    assert.equal(stats.bought + stats.gaveUp, 200, context);

    assert.notEqual(invariants.checkedAt, null, 'the invariant checker ran during the sale');
    assert.equal(invariants.seatsInMultipleConfirmedOrders, 0);
    assert.equal(invariants.soldSeatsWithoutConfirmedOrder, 0);
    assert.equal(invariants.capturedPaymentsWithoutConfirmedOrder, 0);
  } finally {
    await server.close();
  }
});

test('stop() leaves no bot in a running bucket', async () => {
  const server = await startServer();
  try {
    const { crowd } = await buildCrowd(server, 3);

    crowd.send(20);
    crowd.stop();
    await crowd.idle();

    const stats = crowd.stats();
    const total = stats.queued + stats.shopping + stats.paying + stats.bought + stats.gaveUp + stats.failed;
    assert.equal(total, 20);
    assert.equal(stats.queued, 0);
    assert.equal(stats.shopping, 0);
    assert.equal(stats.paying, 0);
    assert.equal(stats.gaveUp, 20, 'stopped bots leave empty-handed');
  } finally {
    await server.close();
  }
});

test('bots sent after a stop() shop normally', async () => {
  const server = await startServer();
  try {
    const { crowd } = await buildCrowd(server, 4);

    crowd.send(5);
    crowd.stop();
    await crowd.idle();
    crowd.send(10);
    await crowd.idle();

    const stats = crowd.stats();
    assert.equal(stats.failed, 0, `expected no failures; lastFailure: ${crowd.lastFailure()}`);
    assert.ok(stats.bought > 0, `expected purchases from the second wave, stats=${JSON.stringify(stats)}`);
  } finally {
    await server.close();
  }
});
