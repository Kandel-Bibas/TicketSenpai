// Simulated crowd of bot shoppers driving the mock backend through the same
// client the demo page uses. No DOM access, so it runs under Node and the browser.
import { ApiError, newIdempotencyKey } from './api.js';

/** Thrown for any expected end-of-journey that is not a purchase. Never counted as `failed`. */
class GiveUp extends Error {}

const MAX_IN_FLIGHT = 6;

const defaultSleep =(ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pick = (array, random) => array[Math.floor(random() * array.length)];

function shuffled(array, random) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Seats with status "available" in `sectionSeats`, preferring a run of `quantity`
// consecutive seat numbers in one row; falls back to any available seats in the section.
function pickSeatsInSection(sectionSeats, availableIds, quantity) {
  const byRow = new Map();
  for (const seat of sectionSeats) {
    if (!availableIds.has(seat.seatId)) continue;
    if (!byRow.has(seat.row)) byRow.set(seat.row, []);
    byRow.get(seat.row).push(seat);
  }
  for (const rowSeats of byRow.values()) {
    rowSeats.sort((a, b) => a.number - b.number);
    for (let i = 0; i + quantity <= rowSeats.length; i++) {
      let consecutive = true;
      for (let j = 1; j < quantity && consecutive; j++) consecutive = rowSeats[i + j].number === rowSeats[i].number + j;
      if (consecutive) return rowSeats.slice(i, i + quantity).map((s) => s.seatId);
    }
  }
  return sectionSeats.filter((s) => availableIds.has(s.seatId)).slice(0, quantity).map((s) => s.seatId);
}

function pickPaymentToken(random) {
  const r = random();
  if (r < 0.85) return 'tok_visa';
  if (r < 0.93) return 'tok_decline';
  if (r < 0.97) return 'tok_timeout_charged';
  return 'tok_timeout_uncharged';
}

/**
 * @typedef {{ queued: number, shopping: number, paying: number, bought: number, gaveUp: number, failed: number }} CrowdStats
 */

/**
 * @param {{
 *   api: ReturnType<import('./api.js').createApi>,
 *   eventId: string,
 *   seatMap: object,
 *   seatLimit: number,
 *   onChange?: () => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   random?: () => number
 * }} deps
 */
export function createCrowd({ api, eventId, seatMap, seatLimit, onChange = () => {}, sleep = defaultSleep, random = Math.random }) {
  const buckets = new Map(); // accountId -> bucket
  const allSections = seatMap.sections.map((s) => s.section);
  const reservedSections = seatMap.sections.filter((s) => !s.generalAdmission).map((s) => s.section);
  const seatsBySection = new Map(seatMap.sections.map((s) => [s.section, s.seats]));

  // stop() ends the current generation; bots sent afterwards belong to a new one and run normally.
  let generation = 0;
  let runningCount = 0;
  let idleWaiters = [];
  let lastFailureMessage = null;

  // The crowd is one client. A browser caps connections per host by itself; under Node nothing
  // does, and hundreds of simultaneous connects overflow the server's accept queue (ECONNRESET).
  let inFlight = 0;
  const waitingForSlot = [];
  async function withSlot(fn) {
    if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waitingForSlot.push(resolve));
    else inFlight += 1;
    try {
      return await fn();
    } finally {
      const next = waitingForSlot.shift();
      if (next) next();
      else inFlight -= 1;
    }
  }

  function setBucket(accountId, bucket) {
    if (buckets.get(accountId) === bucket) return;
    buckets.set(accountId, bucket);
    onChange();
  }

  function think(minSeconds, maxSeconds) {
    return sleep((minSeconds + random() * (maxSeconds - minSeconds)) * 1000);
  }

  // Every API call goes through here: checks the stop flag, retries rate-limited
  // requests after the server's cooldown, and turns token_expired into a give-up.
  async function req(session, fn) {
    while (true) {
      if (session.generation !== generation) throw new GiveUp('stopped');
      try {
        return await withSlot(fn);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'rate_limited') {
          await sleep((err.retryAfterSeconds ?? 1) * 1000);
          continue;
        }
        if (err instanceof ApiError && err.code === 'token_expired') throw new GiveUp('token_expired');
        throw err;
      }
    }
  }

  async function joinAndAdmit(session) {
    let status;
    try {
      status = await req(session, () => api.joinQueue(eventId, session));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sold_out') throw new GiveUp('sold_out');
      throw err;
    }
    while (status.state !== 'admitted') {
      if (status.state === 'sold_out' || status.state === 'expired') throw new GiveUp(status.state);
      await sleep((status.pollAfterSeconds ?? 5) * 1000);
      status = await req(session, () => api.queueStatus(eventId, session, { quiet: true }));
    }
    session.token = status.admissionToken;
  }

  // Returns the hold, or null on seat_taken / not_enough_seats so the caller can fall back.
  async function holdBestAvailable(session, section, quantity) {
    try {
      return await req(session, () => api.createHold(eventId, session, newIdempotencyKey('bot-hold'), { bestAvailable: { section, quantity } }));
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'seat_taken' || err.code === 'not_enough_seats')) return null;
      throw err;
    }
  }

  async function bestAvailableAnySection(session, quantity) {
    for (const section of shuffled(allSections, random)) {
      const hold = await holdBestAvailable(session, section, quantity);
      if (hold) return hold;
    }
    return null;
  }

  async function acquireHold(session, quantity) {
    let hold = null;
    if (reservedSections.length > 0 && random() < 0.5) {
      const section = pick(reservedSections, random);
      const availability = await req(session, () => api.availability(eventId, session, { quiet: true }));
      const availableIds = new Set(availability.seats.filter((s) => s.status === 'available').map((s) => s.seatId));
      const picked = pickSeatsInSection(seatsBySection.get(section), availableIds, quantity);
      if (picked.length > 0) {
        try {
          hold = await req(session, () => api.createHold(eventId, session, newIdempotencyKey('bot-hold'), { seatIds: picked }));
        } catch (err) {
          if (!(err instanceof ApiError) || (err.code !== 'seat_taken' && err.code !== 'not_enough_seats')) throw err;
        }
      }
    } else {
      hold = await holdBestAvailable(session, pick(allSections, random), quantity);
    }

    if (hold) return hold;
    hold = await bestAvailableAnySection(session, quantity);
    if (hold) return hold;
    hold = await bestAvailableAnySection(session, 1);
    if (!hold) throw new GiveUp('not_enough_seats');
    return hold;
  }

  async function placeOrderOnHold(session, holdId, paymentToken) {
    try {
      return await req(session, () => api.placeOrder(eventId, session, newIdempotencyKey('bot-order'), { holdId, paymentToken }));
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'hold_expired' || err.code === 'hold_not_found')) throw new GiveUp(err.code);
      throw err;
    }
  }

  async function payUntilTerminal(session, holdId, orderId) {
    let declinedOnce = false;
    while (true) {
      await sleep(1000);
      const order = await req(session, () => api.getOrder(eventId, session, orderId, { quiet: true }));
      if (order.status === 'confirmed') return;
      if (order.status === 'declined') {
        if (declinedOnce) throw new GiveUp('card_declined_twice');
        declinedOnce = true;
        const retry = await placeOrderOnHold(session, holdId, 'tok_visa');
        orderId = retry.body.orderId;
        continue;
      }
      if (order.status === 'cancelled') throw new GiveUp(order.reason ?? 'cancelled');
      // payment_in_flight / payment_unknown: keep polling.
    }
  }

  async function runBot(accountId) {
    setBucket(accountId, 'queued');
    const session = { accountId, token: null, generation };
    try {
      await joinAndAdmit(session);
      setBucket(accountId, 'shopping');
      await think(1, 4);
      const maxQuantity = Math.max(1, Math.min(4, seatLimit));
      const quantity = 1 + Math.floor(random() * maxQuantity);
      const hold = await acquireHold(session, quantity);
      await think(1, 5);
      const order = await placeOrderOnHold(session, hold.body.holdId, pickPaymentToken(random));
      setBucket(accountId, 'paying');
      await payUntilTerminal(session, hold.body.holdId, order.body.orderId);
      setBucket(accountId, 'bought');
    } catch (err) {
      if (err instanceof GiveUp) {
        setBucket(accountId, 'gaveUp');
      } else {
        lastFailureMessage = err instanceof Error ? err.message : String(err);
        setBucket(accountId, 'failed');
      }
    }
  }

  function launch(accountId) {
    runningCount += 1;
    runBot(accountId).finally(() => {
      runningCount -= 1;
      if (runningCount === 0) {
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    });
  }

  return {
    send(count) {
      // Random ids: the backend remembers accounts across page reloads, and a reused id would inherit its seat limit.
      for (let i = 0; i < count; i++) launch(`bot_${crypto.randomUUID().slice(0, 8)}`);
    },

    stop: () => { generation += 1; },

    /** @returns {CrowdStats} */
    stats() {
      const result = { queued: 0, shopping: 0, paying: 0, bought: 0, gaveUp: 0, failed: 0 };
      for (const bucket of buckets.values()) result[bucket] += 1;
      return result;
    },

    idle: () => (runningCount === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve))),
    lastFailure: () => lastFailureMessage,
  };
}
