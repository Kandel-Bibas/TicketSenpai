import { ApiError } from './errors.js';
import { createRateBudget } from './rateBudget.js';

const MIN_POLL_SECONDS = 5;
const MAX_POLL_SECONDS = 60;

/**
 * Waiting room plus its queue state (positions and a head pointer).
 * Login required, one position per account, random draw for everyone present
 * at T0, FIFO afterwards. Admits at the rate the admission controller commands;
 * a command older than its TTL counts as rate zero.
 * @param {{
 *   catalog: ReturnType<import('./catalog.js').createCatalog>,
 *   tokens: ReturnType<import('./token.js').createTokenService>,
 *   metrics: ReturnType<import('./metrics.js').createMetrics>,
 *   clock: { now: () => number },
 *   randomInt: (maxExclusive: number) => number,
 *   rateCommandTtlMs: number
 * }} deps
 */
export function createWaitingRoom({ catalog, tokens, metrics, clock, randomInt, rateCommandTtlMs }) {
  const rooms = new Map();

  function roomFor(eventId) {
    let room = rooms.get(eventId);
    if (!room) {
      room = {
        entries: new Map(),   // accountId → current entry
        pool: [],             // joined before the draw, no position yet
        line: [],             // positions after the draw; line[head] is next
        head: 0,
        drawn: false,
        command: { ratePerSecond: 0, issuedAt: clock.now(), paused: false, soldOut: false },
        budget: createRateBudget(clock),
      };
      rooms.set(eventId, room);
    }
    return room;
  }

  function enqueue(room, entry) {
    room.line.push(entry);
    entry.position = room.line.length;
  }

  function draw(room) {
    const pool = room.pool;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const entry of pool) enqueue(room, entry);
    room.pool = [];
    room.drawn = true;
  }

  function effectiveRate(room) {
    const { ratePerSecond, issuedAt } = room.command;
    return clock.now() - issuedAt > rateCommandTtlMs ? 0 : ratePerSecond;
  }

  const tokenExpired = (entry) => entry.admittedAt !== null && clock.now() >= entry.tokenExpiresAt;

  function describe(room, entry) {
    if (entry.admittedAt !== null) {
      return tokenExpired(entry)
        ? { state: 'expired', position: entry.position }
        : { state: 'admitted', position: entry.position, admissionToken: entry.token, tokenExpiresAt: new Date(entry.tokenExpiresAt).toISOString() };
    }
    if (room.command.soldOut) return { state: 'sold_out', position: entry.position };

    const ahead = entry.position === null ? null : entry.position - 1 - room.head;
    const rate = effectiveRate(room);
    // Poll roughly twice per expected wait: 5 s near the front, 60 s at the back.
    const pollAfterSeconds = ahead === null || rate === 0
      ? MAX_POLL_SECONDS
      : Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(ahead / rate / 2)));
    const state = room.command.paused ? 'paused' : entry.position === null ? 'pre_sale' : 'waiting';
    return { state, position: entry.position, ahead, pollAfterSeconds };
  }

  return {
    /** @returns {{ created: boolean, status: object }} */
    join(eventId, accountId) {
      catalog.getEvent(eventId);
      const room = roomFor(eventId);
      const existing = room.entries.get(accountId);
      if (existing && !tokenExpired(existing)) return { created: false, status: describe(room, existing) };
      if (room.command.soldOut) throw new ApiError(409, 'sold_out', 'This event is sold out');

      const entry = { accountId, joinedAt: clock.now(), position: null, admittedAt: null, token: null, tokenExpiresAt: null };
      room.entries.set(accountId, entry);
      if (room.drawn) enqueue(room, entry);
      else room.pool.push(entry);
      return { created: true, status: describe(room, entry) };
    },

    status(eventId, accountId) {
      catalog.getEvent(eventId);
      const room = roomFor(eventId);
      const entry = room.entries.get(accountId);
      if (!entry) throw new ApiError(404, 'not_in_queue', 'This account has not joined the queue for this event');
      return describe(room, entry);
    },

    // Waiting-room tick: performs the T0 draw, then admits at the commanded rate.
    admit() {
      for (const event of catalog.allEvents()) {
        const room = roomFor(event.eventId);
        if (!room.drawn && clock.now() >= event.onSaleAt) draw(room);

        const open = room.drawn && !room.command.paused && !room.command.soldOut;
        let allowance = room.budget.take(open ? effectiveRate(room) : 0);
        while (allowance-- > 0 && room.head < room.line.length) {
          const entry = room.line[room.head++];
          const { token, expiresAt } = tokens.issue({ accountId: entry.accountId, eventId: event.eventId });
          entry.admittedAt = clock.now();
          entry.token = token;
          entry.tokenExpiresAt = expiresAt;
          metrics.recordTokenIssued(event.eventId);
        }
      }
    },

    /** @param {{ ratePerSecond: number, paused: boolean, soldOut: boolean }} command */
    command(eventId, command) {
      roomFor(eventId).command = { ...command, issuedAt: clock.now() };
    },

    depth(eventId) {
      const room = roomFor(eventId);
      return room.pool.length + room.line.length - room.head;
    },

    // Accounts holding an unexpired admission token.
    admitted(eventId) {
      const result = [];
      for (const entry of roomFor(eventId).entries.values()) {
        if (entry.admittedAt !== null && !tokenExpired(entry)) result.push({ accountId: entry.accountId, admittedAt: entry.admittedAt });
      }
      return result;
    },

    effectiveRate: (eventId) => effectiveRate(roomFor(eventId)),
  };
}
