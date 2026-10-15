import { NetworkError } from './api.js';
import { h } from './dom.js';

const POLL_MS = 1000;

const RATE_REASONS = {
  computed: 'computed from how many admitted shoppers are still active',
  override: 'set by operator override',
  sold_out: 'closed: sold out',
  paused: 'closed: paused by the operator',
  invariant_violated: 'closed: an invariant was violated',
  psp_breaker_open: 'closed: the payment provider breaker is not closed',
  hold_latency: 'closed: hold latency is above its limit',
  payment_age: 'closed: the oldest payment has waited too long',
  no_unheld_seats: 'closed: every unsold seat is currently held',
};

const stat = (label) => {
  const value = h('dd', { class: 'num', text: '–' });
  return { value, element: h('div', { class: 'stat' }, h('dt', { text: label }), value) };
};

/**
 * The on-sale control room: polls the dashboard and exposes the operator controls.
 * @param {{
 *   api: ReturnType<import('./api.js').createApi>,
 *   eventId: string,
 *   onConnection: (online: boolean) => void,
 *   onDashboard: (dashboard: { saleState: string }) => void
 * }} options
 */
export function createOperator({ api, eventId, onConnection, onDashboard }) {
  const rate = h('p', { class: 'valve-rate num', text: '–' });
  const rateReason = h('p', { class: 'valve-reason' });
  const stats = {
    depth: stat('Waiting in queue'), admitted: stat('Admitted, token live'), active: stat('Active shoppers'), tokens: stat('Tokens issued'),
    attempts: stat('Hold attempts'), succeeded: stat('Holds won'), seatTaken: stat('Lost the race'), p99: stat('Hold p99'),
    outbox: stat('Oldest outbox row'), viewLag: stat('View lag'), payAge: stat('Oldest payment'), payQueued: stat('Payments queued'), dead: stat('Dead letters'),
    psp: stat('Provider'), breaker: stat('Breaker'),
    multi: stat('Seats sold twice'), orphanSold: stat('Sold without an order'), orphanCapture: stat('Charged without an order'),
  };

  const segments = { available: h('span', { class: 'bar-seg', dataset: { status: 'available' } }), held: h('span', { class: 'bar-seg', dataset: { status: 'held' } }), sold: h('span', { class: 'bar-seg', dataset: { status: 'sold' } }) };
  const barCounts = { available: h('span', { class: 'num' }), held: h('span', { class: 'num' }), sold: h('span', { class: 'num' }) };
  const bar = h('div', { class: 'bar', role: 'img' }, segments.available, segments.held, segments.sold);
  const invariantsChecked = h('p', { class: 'hint' });

  const pauseButton = h('button', { type: 'button', class: 'btn', text: 'Pause admissions' });
  const pspButton = h('button', { type: 'button', class: 'btn', text: 'Take the payment provider down' });
  const rateInput = h('input', { type: 'number', id: 'rate-override', min: 0, max: 10000, step: 1, inputmode: 'numeric', placeholder: 'e.g. 2' });
  const setRateButton = h('button', { type: 'submit', class: 'btn', text: 'Set rate' });
  const clearRateButton = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Clear override' });
  const controlStatus = h('p', { class: 'control-status', role: 'status' });

  let latest = null;

  async function act(describe, call) {
    controlStatus.classList.remove('is-error');
    try {
      await call();
      controlStatus.textContent = describe;
      await refresh();
    } catch (err) {
      controlStatus.classList.add('is-error');
      controlStatus.textContent = err.code ? `${err.code}: ${err.message}` : err.message;
    }
  }

  pauseButton.addEventListener('click', () => (latest?.admission.paused
    ? act('Admissions resumed.', () => api.resume(eventId))
    : act('Admissions paused. Live holds are extended while the pause lasts.', () => api.pause(eventId))));
  pspButton.addEventListener('click', () => (latest?.psp.mode === 'down'
    ? act('Payment provider is back up. The breaker closes after its next successful probe.', () => api.setPspMode('up'))
    : act('Payment provider is down. Five failed calls in a row open the breaker.', () => api.setPspMode('down'))));
  clearRateButton.addEventListener('click', () => act('Override cleared; the controller computes the rate again.', () => api.setReleaseRate(eventId, null)));

  const rateForm = h('form', { class: 'rate-form', onSubmit: (event) => {
    event.preventDefault();
    const value = Number(rateInput.value);
    if (rateInput.value.trim() === '' || !Number.isInteger(value) || value < 0 || value > 10000) {
      controlStatus.classList.add('is-error');
      controlStatus.textContent = 'Release rate must be a whole number from 0 to 10000.';
      return;
    }
    act(`Release rate overridden to ${value}/s. Safety gates can still close the valve.`, () => api.setReleaseRate(eventId, value));
  } },
    h('label', { for: 'rate-override', text: 'Release rate override (accounts per second)' }),
    h('div', { class: 'row' }, rateInput, setRateButton, clearRateButton),
  );

  const group = (title, ...items) => h('section', { class: 'stat-group' }, h('h3', { text: title }), h('dl', { class: 'stats' }, ...items.map((s) => s.element)));

  const element = h('section', { class: 'panel operator', 'aria-labelledby': 'operator-title' },
    h('header', { class: 'panel-head' }, h('h2', { id: 'operator-title', text: 'Control room' }), h('p', { class: 'hint', text: 'What the operator sees during the on-sale, refreshed every second.' })),
    h('section', { class: 'valve', 'aria-label': 'Admission valve' }, h('h3', { text: 'Admission valve' }), rate, rateReason),
    group('Queue', stats.depth, stats.admitted, stats.active, stats.tokens),
    h('section', { class: 'stat-group' }, h('h3', { text: 'Inventory' }), bar,
      h('ul', { class: 'legend' },
        h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'available' } }), 'Available ', barCounts.available),
        h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'held' } }), 'Held ', barCounts.held),
        h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'sold' } }), 'Sold ', barCounts.sold),
      )),
    group('Holds', stats.attempts, stats.succeeded, stats.seatTaken, stats.p99),
    group('Payments', stats.psp, stats.breaker, stats.payQueued, stats.payAge, stats.dead),
    group('Pipeline', stats.outbox, stats.viewLag),
    h('section', { class: 'stat-group' }, h('h3', { text: 'Invariants' }),
      h('dl', { class: 'stats' }, stats.multi.element, stats.orphanSold.element, stats.orphanCapture.element), invariantsChecked),
    h('section', { class: 'controls', 'aria-label': 'Operator controls' }, h('h3', { text: 'Controls' }),
      h('div', { class: 'row' }, pauseButton, pspButton), rateForm, controlStatus),
  );

  const ms = (value) => `${Math.round(value)} ms`;
  const flag = (s, bad) => s.element.classList.toggle('is-bad', bad);

  function render(d) {
    latest = d;
    const decision = d.admission.decision;
    rate.textContent = `${d.admission.effectiveRatePerSecond} per second`;
    rateReason.textContent = decision === null ? 'The controller has not ticked yet.' : `Rate is ${RATE_REASONS[decision.reason] ?? decision.reason}.`;
    element.querySelector('.valve').classList.toggle('is-closed', d.admission.effectiveRatePerSecond === 0);

    stats.depth.value.textContent = d.queue.depth;
    stats.admitted.value.textContent = d.queue.admittedWithLiveToken;
    stats.active.value.textContent = decision === null ? '–' : decision.activeShoppers;
    stats.tokens.value.textContent = d.holds.tokensIssued;
    stats.attempts.value.textContent = d.holds.holdAttempts;
    stats.succeeded.value.textContent = d.holds.holdsSucceeded;
    stats.seatTaken.value.textContent = d.holds.seatTaken;
    stats.p99.value.textContent = ms(d.holds.holdP99Ms);
    stats.outbox.value.textContent = ms(d.pipeline.oldestOutboxAgeMs);
    stats.viewLag.value.textContent = ms(d.pipeline.viewLagMs);
    stats.payAge.value.textContent = ms(d.pipeline.oldestInFlightPaymentAgeMs);
    stats.payQueued.value.textContent = d.pipeline.paymentsQueued;
    stats.dead.value.textContent = d.pipeline.deadLetters;
    stats.psp.value.textContent = d.psp.mode;
    stats.breaker.value.textContent = d.psp.breaker.replace('_', ' ');
    stats.multi.value.textContent = d.invariants.seatsInMultipleConfirmedOrders;
    stats.orphanSold.value.textContent = d.invariants.soldSeatsWithoutConfirmedOrder;
    stats.orphanCapture.value.textContent = d.invariants.capturedPaymentsWithoutConfirmedOrder;
    flag(stats.psp, d.psp.mode !== 'up');
    flag(stats.breaker, d.psp.breaker !== 'closed');
    flag(stats.dead, d.pipeline.deadLetters > 0);
    flag(stats.multi, d.invariants.seatsInMultipleConfirmedOrders > 0);
    flag(stats.orphanSold, d.invariants.soldSeatsWithoutConfirmedOrder > 0);
    flag(stats.orphanCapture, d.invariants.capturedPaymentsWithoutConfirmedOrder > 0);
    invariantsChecked.textContent = d.invariants.checkedAt === null
      ? 'Not checked yet; the checker runs every 5 seconds.'
      : `Last checked at ${new Date(d.invariants.checkedAt).toLocaleTimeString()}. Any count above zero closes the valve.`;

    const { total, available, held, sold } = d.inventory;
    for (const [status, count] of Object.entries({ available, held, sold })) {
      segments[status].style.flexGrow = String(count);
      segments[status].hidden = count === 0;
      segments[status].title = `${status}: ${count} of ${total}`;
      barCounts[status].textContent = count;
    }
    bar.setAttribute('aria-label', `${available} available, ${held} held, ${sold} sold, of ${total} seats`);

    pauseButton.textContent = d.admission.paused ? 'Resume admissions' : 'Pause admissions';
    pspButton.textContent = d.psp.mode === 'down' ? 'Bring the payment provider back' : 'Take the payment provider down';
    clearRateButton.disabled = d.admission.overrideRate === null;
    onDashboard(d);
  }

  async function refresh() {
    render(await api.dashboard(eventId));
  }

  async function poll() {
    try {
      await refresh();
      onConnection(true);
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
      onConnection(false);
    } finally {
      setTimeout(poll, POLL_MS);
    }
  }

  return { element, start: poll, latest: () => latest };
}
