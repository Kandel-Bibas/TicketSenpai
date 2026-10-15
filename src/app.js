// Composition root: builds every module with its collaborators injected.
import { randomBytes, randomInt as cryptoRandomInt } from 'node:crypto';
import { createAdmissionController } from './admissionController.js';
import { createAvailabilityView } from './availabilityView.js';
import { createBreaker } from './breaker.js';
import { createCatalog } from './catalog.js';
import { createCheckout } from './checkout.js';
import { createFulfilment } from './fulfilment.js';
import { createGateway } from './http/gateway.js';
import { createIdempotency } from './http/idempotency.js';
import { createRoutes } from './http/routes.js';
import { createRequestHandler } from './http/server.js';
import { createInvariantChecker } from './invariants.js';
import { createInventory } from './inventory.js';
import { createMetrics } from './metrics.js';
import { createOrders } from './orders.js';
import { createMockPsp } from './psp.js';
import { createQueue } from './queue.js';
import { createRelay } from './relay.js';
import { seedDemoEvent } from './seed.js';
import { createStore } from './store.js';
import { createTokenService } from './token.js';
import { createWaitingRoom } from './waitingRoom.js';

/**
 * @param {{
 *   config: ReturnType<import('./config.js').loadConfig>,
 *   clock: { now: () => number },
 *   logger: ReturnType<import('./log.js').createLogger>,
 *   randomInt?: (maxExclusive: number) => number
 * }} deps
 */
export function createApp({ config, clock, logger, randomInt = cryptoRandomInt }) {
  let tokenSecret = config.tokenSecret;
  if (tokenSecret === null) {
    // All state is in memory, so a key that dies with the process loses nothing.
    tokenSecret = randomBytes(32).toString('hex');
    logger.warn('ADMISSION_TOKEN_SECRET is not set; using an ephemeral signing key for this process');
  }

  const store = createStore({ clock });
  const metrics = createMetrics();
  const catalog = createCatalog({ store });
  const tokens = createTokenService({ keys: { [config.tokenKid]: tokenSecret }, activeKid: config.tokenKid, ttlMs: config.tokenTtlMs, clock });
  const queue = createQueue({ clock, logger });
  const psp = createMockPsp();
  const breaker = createBreaker({ clock, failureThreshold: config.breakerFailureThreshold, cooldownMs: config.breakerCooldownMs });
  const view = createAvailabilityView({ clock });
  const inventory = createInventory({ store, clock, holdTtlMs: config.holdTtlMs });
  const orders = createOrders({ store, catalog, inventory, clock, logger });
  const checkout = createCheckout({
    store, orders, psp, breaker, queue, metrics, clock, logger,
    pspMaxTps: config.pspMaxTps, reconcileAfterMs: config.reconcileAfterMs,
  });
  const fulfilment = createFulfilment({ orders, queue, logger });
  const relay = createRelay({ store, view, queue });
  const waitingRoom = createWaitingRoom({ catalog, tokens, metrics, clock, randomInt, rateCommandTtlMs: config.rateCommandTtlMs });
  const invariants = createInvariantChecker({ catalog, inventory, orders, psp, clock, logger });
  const controller = createAdmissionController({ catalog, waitingRoom, inventory, orders, breaker, invariants, metrics, clock, logger, config });
  const gateway = createGateway({ tokens, clock, ratePerSecond: config.tokenRateLimitPerSecond });
  const idempotency = createIdempotency(store.idempotency);

  seedDemoEvent(catalog, { onSaleAt: clock.now() + config.saleStartsInMs });
  for (const event of catalog.allEvents()) view.rebuild(event.eventId, inventory.seats(event.eventId));

  const services = { store, metrics, catalog, tokens, queue, psp, breaker, view, inventory, orders, checkout, fulfilment, relay, waitingRoom, invariants, controller, gateway, idempotency };
  const routes = createRoutes(services);

  return {
    services,
    handler: createRequestHandler({ routes, gateway, logger, maxBodyBytes: config.maxBodyBytes }),
    // The background loops of the worker role and the edge. main.js runs them on
    // timers; tests call `run` directly against a manual clock.
    loops: [
      { name: 'relay', everyMs: 100, run: () => relay.publishOutbox() },
      { name: 'payments', everyMs: 250, run: () => checkout.processPayments() },
      { name: 'fulfilment', everyMs: 500, run: () => fulfilment.processFulfilment() },
      { name: 'reconciler', everyMs: 1000, run: () => checkout.reconcileUnknownPayments() },
      { name: 'waitingRoom', everyMs: 1000, run: () => waitingRoom.admit() },
      { name: 'sweeper', everyMs: 1000, run: () => { inventory.sweepExpiredHolds(); gateway.forgetExpiredTokens(); } },
      { name: 'admissionController', everyMs: 2000, run: () => controller.run() },
      { name: 'invariantChecker', everyMs: 5000, run: () => invariants.check() },
    ],
  };
}
