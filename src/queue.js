const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 30_000;

/**
 * Durable-queue stand-in: at-least-once, per-topic, with a dead-letter queue.
 * A received message stays queued until it is acked, so a consumer that dies
 * mid-message sees it again — consumers must be idempotent.
 * @param {{ clock: { now: () => number }, logger: ReturnType<import('./log.js').createLogger> }} deps
 */
export function createQueue({ clock, logger }) {
  const topics = new Map();
  const deadLetters = [];
  let seq = 0;

  const topic = (name) => {
    if (!topics.has(name)) topics.set(name, []);
    return topics.get(name);
  };

  function remove(name, id) {
    const messages = topic(name);
    const index = messages.findIndex((m) => m.id === id);
    if (index === -1) throw new Error(`Message ${id} is not on topic ${name}`);
    return messages.splice(index, 1)[0];
  }

  return {
    publish(name, body) {
      topic(name).push({ id: ++seq, topic: name, body, enqueuedAt: clock.now(), attempts: 0, visibleAt: 0 });
    },

    receive(name, max) {
      const now = clock.now();
      return topic(name).filter((m) => m.visibleAt <= now).slice(0, max);
    },

    ack: (name, id) => { remove(name, id); },

    nack(name, id, reason) {
      const message = topic(name).find((m) => m.id === id);
      if (!message) throw new Error(`Message ${id} is not on topic ${name}`);
      message.attempts += 1;
      if (message.attempts >= MAX_ATTEMPTS) {
        deadLetters.push({ ...remove(name, id), reason, deadAt: clock.now() });
        logger.error('message moved to dead-letter queue', { topic: name, messageId: id, reason });
        return;
      }
      message.visibleAt = clock.now() + Math.min(1000 * 2 ** (message.attempts - 1), MAX_BACKOFF_MS);
    },

    // Redeliver later without counting an attempt: the message is fine, its dependency is not.
    defer(name, id, delayMs) {
      const message = topic(name).find((m) => m.id === id);
      if (!message) throw new Error(`Message ${id} is not on topic ${name}`);
      message.visibleAt = clock.now() + delayMs;
    },

    depth: (name) => topic(name).length,
    deadLetterCount: () => deadLetters.length,
  };
}
