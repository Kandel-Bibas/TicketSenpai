/**
 * The valve. Each tick reads the health signals and commands a release rate:
 *
 *   if hold_p99 > 300ms or pay_queue_age > 30s or psp_breaker_open or unheld_seats == 0: rate = 0
 *   else rate = clamp(target_active - active, 0, max_rate)
 *
 * plus the operator kill switch, a manual override, and the invariant checker.
 * The override replaces only the computed rate; every zero-gate still applies.
 * @param {{
 *   catalog: ReturnType<import('./catalog.js').createCatalog>,
 *   waitingRoom: ReturnType<import('./waitingRoom.js').createWaitingRoom>,
 *   inventory: ReturnType<import('./inventory.js').createInventory>,
 *   orders: ReturnType<import('./orders.js').createOrders>,
 *   breaker: ReturnType<import('./breaker.js').createBreaker>,
 *   invariants: ReturnType<import('./invariants.js').createInvariantChecker>,
 *   metrics: ReturnType<import('./metrics.js').createMetrics>,
 *   clock: { now: () => number },
 *   logger: ReturnType<import('./log.js').createLogger>,
 *   config: ReturnType<import('./config.js').loadConfig>
 * }} deps
 */
export function createAdmissionController({ catalog, waitingRoom, inventory, orders, breaker, invariants, metrics, clock, logger, config }) {
  const controls = new Map();

  function controlFor(eventId) {
    let control = controls.get(eventId);
    if (!control) {
      control = { paused: false, overrideRate: null, lastTickAt: clock.now(), decision: null };
      controls.set(eventId, control);
    }
    return control;
  }

  function activeShoppers(eventId) {
    return waitingRoom.admitted(eventId)
      .filter(({ accountId, admittedAt }) => !orders.hasConfirmedSince(eventId, accountId, admittedAt))
      .length;
  }

  function decide(eventId, control) {
    const counts = inventory.counts(eventId);
    const active = activeShoppers(eventId);
    const soldOut = counts.sold === counts.total;

    let reason = null;
    if (soldOut) reason = 'sold_out';
    else if (control.paused) reason = 'paused';
    else if (invariants.violated()) reason = 'invariant_violated';
    else if (breaker.state() !== 'closed') reason = 'psp_breaker_open';
    else if (metrics.holdP99Ms(eventId) > config.holdP99LimitMs) reason = 'hold_latency';
    else if (orders.oldestInFlightAgeMs(eventId) > config.paymentAgeLimitMs) reason = 'payment_age';
    else if (counts.available === 0) reason = 'no_unheld_seats';

    let ratePerSecond = 0;
    if (reason === null) {
      ratePerSecond = control.overrideRate ?? Math.min(Math.max(config.targetActiveShoppers - active, 0), config.maxReleaseRate);
      reason = control.overrideRate === null ? 'computed' : 'override';
    }
    return { ratePerSecond, reason, soldOut, activeShoppers: active, decidedAt: clock.now() };
  }

  function apply(eventId) {
    const control = controlFor(eventId);
    const decision = decide(eventId, control);
    const now = clock.now();

    // An outage that is not the shopper's fault must not cost them their seats.
    if (decision.reason === 'paused' || decision.reason === 'psp_breaker_open') {
      inventory.extendLiveHolds(eventId, now - control.lastTickAt);
    }
    control.lastTickAt = now;

    if (!control.decision || control.decision.ratePerSecond !== decision.ratePerSecond || control.decision.reason !== decision.reason) {
      logger.info('release rate changed', { eventId, ratePerSecond: decision.ratePerSecond, reason: decision.reason });
    }
    control.decision = decision;
    waitingRoom.command(eventId, { ratePerSecond: decision.ratePerSecond, paused: control.paused, soldOut: decision.soldOut });
    return decision;
  }

  return {
    // Controller tick (every 2 s).
    run() {
      for (const event of catalog.allEvents()) apply(event.eventId);
    },

    // Kill switch. Applied immediately rather than on the next tick.
    pause(eventId) {
      catalog.getEvent(eventId);
      controlFor(eventId).paused = true;
      return apply(eventId);
    },
    resume(eventId) {
      catalog.getEvent(eventId);
      controlFor(eventId).paused = false;
      return apply(eventId);
    },
    /** @param {number | null} ratePerSecond null clears the override */
    setOverride(eventId, ratePerSecond) {
      catalog.getEvent(eventId);
      controlFor(eventId).overrideRate = ratePerSecond;
      return apply(eventId);
    },

    /** @returns {'scheduled' | 'on_sale' | 'paused' | 'sold_out'} */
    saleState(eventId) {
      const event = catalog.getEvent(eventId);
      const counts = inventory.counts(eventId);
      if (counts.sold === counts.total) return 'sold_out';
      if (controlFor(eventId).paused) return 'paused';
      return clock.now() < event.onSaleAt ? 'scheduled' : 'on_sale';
    },

    status(eventId) {
      const control = controlFor(eventId);
      return { paused: control.paused, overrideRate: control.overrideRate, decision: control.decision };
    },
  };
}
