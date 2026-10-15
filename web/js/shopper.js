import { ApiError, NetworkError, newIdempotencyKey } from './api.js';
import { formatCountdown, h, money, plural } from './dom.js';
import { createSeatMap } from './seatMap.js';

const TICK_MS = 250;
const AVAILABILITY_POLL_MS = 2000;
const ORDER_POLL_MS = 700;

const STEPS = ['Queue', 'Seats', 'Payment', 'Tickets'];
const STEP_OF_PHASE = { idle: 0, queued: 0, admitted: 1, holding: 2, ordering: 2, done: 3 };

const TEST_CARDS = [
  { token: 'tok_visa', label: 'Approved', detail: 'The order confirms and tickets are issued.' },
  { token: 'tok_decline', label: 'Declined', detail: 'The order is declined; your seats stay held so you can pay again.' },
  { token: 'tok_timeout_charged', label: 'Times out, card was charged', detail: 'The reconciler asks the provider a few seconds later and confirms the order.' },
  { token: 'tok_timeout_uncharged', label: 'Times out, card was not charged', detail: 'The reconciler finds no payment, cancels the order and releases the seats.' },
];

const newAccountId = () => `acct_${crypto.randomUUID().slice(0, 8)}`;

/**
 * One shopper's journey: queue, admission, seats, hold, payment, tickets.
 * @param {{
 *   api: ReturnType<import('./api.js').createApi>,
 *   event: { eventId: string, currency: string, seatLimitPerAccount: number },
 *   seatMapData: Parameters<typeof createSeatMap>[0]['seatMap']
 * }} options
 */
export function createShopper({ api, event, seatMapData }) {
  const { eventId, currency } = event;
  const seatLimit = event.seatLimitPerAccount;

  const state = {
    phase: 'idle',
    accountId: newAccountId(),
    queue: null,
    nextQueuePollAt: 0,
    token: null,
    tokenExpiresAt: 0,
    nextAvailabilityAt: 0,
    selection: [],
    bestAvailable: { section: seatMapData.sections[0].section, quantity: '2' },
    hold: null,
    lastHoldRequest: null,
    card: TEST_CARDS[0].token,
    order: null,
    nextOrderPollAt: 0,
    busy: false,
  };
  const inFlight = { queue: false, availability: false, order: false };
  const session = () => ({ accountId: state.accountId, token: state.token });

  const accountLabel = h('code');
  const steps = h('ol', { class: 'steps' }, ...STEPS.map((name) => h('li', { text: name })));
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const action = h('div', { class: 'action' });
  const seatMap = createSeatMap({
    seatMap: seatMapData, currency, seatLimit,
    onSelectionChange({ seatIds, lostSeatIds }) {
      state.selection = seatIds;
      if (lostSeatIds.length > 0) say(`${lostSeatIds.join(', ')} went to another shopper and left your selection.`, 'error');
      render();
    },
  });

  function say(message, kind = 'info') {
    notice.hidden = message === null;
    notice.textContent = message ?? '';
    notice.classList.toggle('is-error', kind === 'error');
  }

  function dropAdmission() {
    state.token = null;
    state.hold = null;
    state.order = null;
    state.queue = null;
    state.selection = [];
    seatMap.clearSelection();
    seatMap.setMine([]);
    seatMap.clearStatuses();
    state.phase = 'idle';
  }

  function backToSeats(message) {
    state.hold = null;
    state.order = null;
    state.selection = [];
    seatMap.clearSelection();
    seatMap.setMine([]);
    state.phase = 'admitted';
    state.nextAvailabilityAt = 0;
    say(message, 'error');
  }

  // The backend is the authority: each code maps to where the shopper can go from here.
  function fail(err) {
    if (err instanceof NetworkError) return say(`${err.message}. Is the backend running?`, 'error');
    if (!(err instanceof ApiError)) throw err;
    switch (err.code) {
      case 'token_expired':
        dropAdmission();
        return say('Your admission token expired. Join the queue again for a new one.', 'error');
      case 'invalid_token':
      case 'not_in_queue':
        dropAdmission();
        return say('The backend does not recognise this session. It keeps state in memory, so a restart forgets everyone. Join the queue again.', 'error');
      case 'seat_taken':
        return backToSeats('Another shopper got one of those seats first; the map can be up to 2 seconds stale. Choose again.');
      case 'hold_expired':
      case 'hold_not_found':
        return backToSeats('Your hold expired and the seats went back on sale. Choose again.');
      case 'rate_limited':
        return say(`The gateway rate-limited this admission token. Try again in ${err.retryAfterSeconds ?? 1} s.`, 'error');
      default:
        return say(`${err.message} (${err.code})`, 'error');
    }
  }

  async function run(work) {
    state.busy = true;
    say(null);
    render();
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      state.busy = false;
      render();
    }
  }

  function applyQueueStatus(status) {
    state.queue = status;
    if (status.state === 'admitted') {
      state.token = status.admissionToken;
      state.tokenExpiresAt = Date.parse(status.tokenExpiresAt);
      state.nextAvailabilityAt = 0;
      state.phase = 'admitted';
      return;
    }
    if (status.state === 'expired') {
      dropAdmission();
      say('Your admission token expired. Join the queue again for a new one.', 'error');
      return;
    }
    state.phase = 'queued';
    state.nextQueuePollAt = Date.now() + (status.pollAfterSeconds ?? 0) * 1000;
  }

  const joinQueue = () => run(async () => applyQueueStatus(await api.joinQueue(eventId, session())));

  async function pollQueue({ quiet }) {
    if (inFlight.queue) return;
    inFlight.queue = true;
    try {
      applyQueueStatus(await api.queueStatus(eventId, session(), { quiet }));
    } catch (err) {
      state.nextQueuePollAt = Date.now() + 5000;
      fail(err);
    } finally {
      inFlight.queue = false;
      render();
    }
  }

  async function refreshAvailability() {
    if (inFlight.availability) return;
    inFlight.availability = true;
    state.nextAvailabilityAt = Date.now() + AVAILABILITY_POLL_MS;
    try {
      const view = await api.availability(eventId, session(), { quiet: true });
      if (state.token !== null) seatMap.setStatuses(view.seats);
    } catch (err) {
      // A drained rate-limit bucket (the burst probe does that) only costs this one refresh.
      if (!(err instanceof ApiError && err.code === 'rate_limited')) fail(err);
      render();
    } finally {
      inFlight.availability = false;
    }
  }

  function createHold(selection) {
    return run(async () => {
      const request = { key: newIdempotencyKey('hold'), selection };
      state.lastHoldRequest = request;
      const { body } = await api.createHold(eventId, session(), request.key, selection);
      state.hold = { holdId: body.holdId, seatIds: body.seatIds, expiresAt: Date.parse(body.expiresAt) };
      state.selection = [];
      seatMap.clearSelection();
      seatMap.setMine(body.seatIds);
      state.phase = 'holding';
      state.nextAvailabilityAt = 0;
    });
  }

  function placeOrder() {
    return run(async () => {
      const { body } = await api.placeOrder(eventId, session(), newIdempotencyKey('order'), { holdId: state.hold.holdId, paymentToken: state.card });
      applyOrder(body);
    });
  }

  function applyOrder(order) {
    state.order = order;
    state.nextOrderPollAt = Date.now() + ORDER_POLL_MS;
    switch (order.status) {
      case 'payment_in_flight':
      case 'payment_unknown':
        state.phase = 'ordering';
        return;
      case 'confirmed':
        state.phase = 'done';
        return;
      case 'declined':
        state.phase = 'holding';
        state.card = TEST_CARDS[0].token;
        say('The card was declined. Your seats are still held, so you can pay with another card.', 'error');
        return;
      case 'cancelled':
        backToSeats(order.reason === 'payment_not_found'
          ? 'The payment provider timed out and the reconciler found no charge, so the order was cancelled and the seats released.'
          : `The order was cancelled (${order.reason}) and the seats released.`);
        return;
      default:
        throw new Error(`Order ${order.orderId} has a status this page does not know: ${order.status}`);
    }
  }

  async function pollOrder() {
    if (inFlight.order) return;
    inFlight.order = true;
    try {
      applyOrder(await api.getOrder(eventId, session(), state.order.orderId, { quiet: true }));
    } catch (err) {
      state.nextOrderPollAt = Date.now() + 3000;
      fail(err);
    } finally {
      inFlight.order = false;
      render();
    }
  }

  function startOver() {
    dropAdmission();
    state.accountId = newAccountId();
    state.lastHoldRequest = null;
    say(null);
    render();
  }

  // ── views ──

  const countdown = (name) => h('span', { class: 'num', dataset: { countdown: name } });
  const button = (text, onClick, { primary = false, disabled = false } = {}) =>
    h('button', { type: 'button', class: primary ? 'btn btn-primary' : 'btn', disabled: disabled || state.busy, onClick, text });

  const tokenLine = () => h('p', { class: 'hint' }, 'Admission token ', h('code', { text: `${state.token.slice(0, 14)}…` }), ', valid for another ', countdown('token'), '.');

  const views = {
    idle: () => [
      h('h3', { tabindex: -1, text: 'Join the waiting room' }),
      h('p', { text: 'Everyone queues first. The backend admits shoppers at the rate the control room allows, then hands each one a signed admission token that unlocks the seat map and checkout.' }),
      h('div', { class: 'row' }, button('Join the queue', joinQueue, { primary: true })),
    ],

    queued: () => {
      const q = state.queue;
      const title = { waiting: `You are number ${q.position} in line`, pre_sale: 'You are in the pre-sale pool', paused: 'Admissions are paused', sold_out: 'Sold out while you waited' }[q.state];
      if (title === undefined) throw new Error(`Queue state this page does not know: ${q.state}`);
      const detail = {
        waiting: `${plural(q.ahead, 'shopper')} ahead of you.`,
        pre_sale: 'Positions are drawn at random for everyone present when the sale opens; after that it is first come, first served.',
        paused: q.position === null ? 'You keep your place in the pool.' : `You keep position ${q.position}. The control room can resume admissions.`,
        sold_out: 'Every seat is sold, so nobody else will be admitted.',
      }[q.state];
      return [
        h('h3', { tabindex: -1, text: title }),
        h('p', { text: detail }),
        q.state === 'sold_out' ? null : h('p', { class: 'hint' }, `The server asked to be polled again in ${q.pollAfterSeconds} s. Next check in `, countdown('queue'), '.'),
        q.state === 'sold_out' ? null : h('div', { class: 'row' }, button('Check now', () => pollQueue({ quiet: false }))),
      ];
    },

    admitted: () => {
      const count = state.selection.length;
      // Kept in state so that re-rendering (every seat click does) leaves the form as the shopper set it.
      const best = state.bestAvailable;
      const section = h('select', { id: 'ba-section', onChange: (e) => { best.section = e.target.value; } },
        ...seatMapData.sections.map((s) => h('option', { value: s.section, selected: s.section === best.section, text: s.generalAdmission ? `${s.section} floor` : `Section ${s.section}` })));
      const quantity = h('input', { id: 'ba-quantity', type: 'number', min: 1, max: seatLimit, value: best.quantity, inputmode: 'numeric', onInput: (e) => { best.quantity = e.target.value; } });
      return [
        h('h3', { tabindex: -1, text: 'You are in. Choose your seats' }),
        tokenLine(),
        h('p', { text: count === 0
          ? `Pick up to ${seatLimit} seats on the map, or let the backend choose for you.`
          : `${state.selection.join(', ')} for ${money(seatMap.priceOf(state.selection), currency)}.` }),
        h('div', { class: 'row' }, button(count === 0 ? 'Hold selected seats' : `Hold ${plural(count, 'seat')}`, () => createHold({ seatIds: state.selection }), { primary: true, disabled: count === 0 })),
        h('form', { class: 'best-available', onSubmit: (e) => {
          e.preventDefault();
          createHold({ bestAvailable: { section: section.value, quantity: Number(quantity.value) } });
        } },
          h('p', { class: 'form-title', text: 'Or take the best available' }),
          h('div', { class: 'row' },
            h('div', { class: 'field' }, h('label', { for: 'ba-section', text: 'Section' }), section),
            h('div', { class: 'field' }, h('label', { for: 'ba-quantity', text: 'Seats' }), quantity),
            h('button', { type: 'submit', class: 'btn', disabled: state.busy, text: 'Hold best available' }),
          )),
      ];
    },

    holding: () => [
      h('h3', { tabindex: -1 }, 'Seats held for ', countdown('hold')),
      h('p', { text: `${state.hold.seatIds.join(', ')} for ${money(seatMap.priceOf(state.hold.seatIds), currency)}. Nobody else can take them while the hold lasts; the server extends it if payments or admissions are down.` }),
      h('fieldset', { class: 'cards' },
        h('legend', { text: 'Pay with a test card' }),
        ...TEST_CARDS.map((card) => h('label', { class: 'card-option' },
          h('input', { type: 'radio', name: 'card', value: card.token, checked: state.card === card.token, onChange: () => { state.card = card.token; } }),
          h('span', {}, h('strong', { text: card.label }), h('code', { text: card.token }), h('span', { class: 'card-detail', text: card.detail })),
        )),
      ),
      h('div', { class: 'row' }, button(`Pay ${money(seatMap.priceOf(state.hold.seatIds), currency)}`, placeOrder, { primary: true })),
      tokenLine(),
    ],

    ordering: () => [
      h('h3', { tabindex: -1, text: state.order.status === 'payment_unknown' ? 'Payment outcome unknown' : 'Payment in flight' }),
      h('p', { text: state.order.status === 'payment_unknown'
        ? 'The payment provider timed out, so nobody knows yet whether the card was charged. Your seats stay pinned to this order until the reconciler asks the provider.'
        : 'The order was accepted (202) and handed to the payment worker through the outbox and queue. Checking its status now.' }),
      h('p', { class: 'hint' }, 'Order ', h('code', { text: state.order.orderId })),
    ],

    done: () => [
      h('h3', { tabindex: -1, text: state.order.tickets.length === 0 ? 'Confirmed. Issuing your tickets' : 'Confirmed. Here are your tickets' }),
      h('p', { text: `${money(state.order.totalCents, state.order.currency)} paid. Tickets are issued off the critical path, so they can arrive a moment after the confirmation.` }),
      h('ul', { class: 'tickets' }, ...state.order.tickets.map((ticket) => h('li', { class: 'ticket' },
        h('div', { class: 'ticket-main' }, h('span', { class: 'ticket-event', text: event.name }), h('span', { class: 'ticket-seat', text: ticket.seatId })),
        h('div', { class: 'ticket-stub' }, h('span', { class: 'barcode', 'aria-hidden': 'true', style: barcodeStyle(ticket.barcode) }), h('code', { text: ticket.barcode })),
      ))),
      h('div', { class: 'row' },
        state.token === null || Date.now() >= state.tokenExpiresAt ? null : button('Buy more seats', () => { backToSeats(null); render(); }),
        button('Start over as a new shopper', startOver)),
    ],
  };

  // Each character becomes one bar and one gap, so every ticket's code looks distinct.
  function barcodeStyle(barcode) {
    const UNIT_PX = 1.5;
    const stops = [];
    let x = 0;
    for (const char of barcode) {
      const code = char.charCodeAt(0);
      const bar = ((code & 3) + 1) * UNIT_PX;
      const gap = (((code >> 2) & 3) + 1) * UNIT_PX;
      stops.push(`currentColor ${x}px ${x + bar}px`, `transparent ${x + bar}px ${x + bar + gap}px`);
      x += bar + gap;
    }
    return `background-image:linear-gradient(90deg, ${stops.join(', ')}); width:${x}px`;
  }

  let renderedPhase = null;
  function render() {
    const focusWasInside = action.contains(document.activeElement);
    accountLabel.textContent = state.accountId;
    [...steps.children].forEach((li, i) => {
      const current = STEP_OF_PHASE[state.phase];
      li.dataset.state = i < current ? 'done' : i === current ? 'current' : 'todo';
      if (i === current) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    seatMap.setInteractive(state.phase === 'admitted' && !state.busy);
    action.replaceChildren(...views[state.phase]().filter(Boolean));
    action.setAttribute('aria-busy', String(state.busy));
    if (focusWasInside && renderedPhase !== state.phase) action.querySelector('h3').focus();
    renderedPhase = state.phase;
    tickCountdowns();
  }

  function tickCountdowns() {
    const deadlines = { queue: state.nextQueuePollAt, token: state.tokenExpiresAt, hold: state.hold?.expiresAt ?? 0 };
    for (const el of action.querySelectorAll('[data-countdown]')) el.textContent = formatCountdown(deadlines[el.dataset.countdown] - Date.now());
  }

  function tick() {
    const now = Date.now();
    if (state.token !== null && now >= state.tokenExpiresAt && state.phase !== 'ordering' && state.phase !== 'done') {
      dropAdmission();
      say('Your admission token expired. Join the queue again for a new one.', 'error');
      render();
    }
    if (state.phase === 'queued' && state.queue.state !== 'sold_out' && now >= state.nextQueuePollAt) pollQueue({ quiet: true });
    if (state.token !== null && now < state.tokenExpiresAt && now >= state.nextAvailabilityAt) refreshAvailability();
    const awaitingTickets = state.phase === 'done' && state.order.tickets.length === 0;
    if ((state.phase === 'ordering' || awaitingTickets) && now >= state.nextOrderPollAt) pollOrder();
    tickCountdowns();
  }

  const element = h('section', { class: 'panel shopper', 'aria-labelledby': 'shopper-title' },
    h('header', { class: 'panel-head' },
      h('h2', { id: 'shopper-title', text: 'Shopper' }),
      h('p', { class: 'hint' }, 'Signed in as ', accountLabel, '. ', h('button', { type: 'button', class: 'link', onClick: startOver, text: 'Start over as a new shopper' })),
    ),
    steps,
    h('div', { class: 'shopper-body' }, h('div', { class: 'shopper-side' }, notice, action), seatMap.element),
  );

  render();
  setInterval(tick, TICK_MS);

  return {
    element,
    session,
    lastHoldRequest: () => state.lastHoldRequest,
  };
}
