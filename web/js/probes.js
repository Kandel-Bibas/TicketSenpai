import { ApiError } from './api.js';
import { h } from './dom.js';

const BURST_SIZE = 30;

/**
 * Requests a well-behaved client would never send, to show how the gateway and the
 * idempotency layer answer them.
 * @param {{
 *   api: ReturnType<import('./api.js').createApi>,
 *   eventId: string,
 *   sections: string[],
 *   shopper: { session: () => import('./api.js').Session, lastHoldRequest: () => { key: string, selection: object } | null }
 * }} options
 */
export function createProbes({ api, eventId, sections, shopper }) {
  const NEEDS_TOKEN = 'Needs an admission token: get admitted in the shopper panel first.';
  const NEEDS_HOLD = 'Needs a hold request to repeat: hold some seats in the shopper panel first.';

  // Resolves to the error code, or to a short description of the success.
  const outcome = (promise, describeSuccess) => promise.then(describeSuccess, (err) => {
    if (err instanceof ApiError) return `${err.status} ${err.code}`;
    throw err;
  });

  const probes = [
    {
      title: 'Ask for availability with no admission token',
      expect: '401 invalid_token',
      run: () => outcome(api.request('GET', `/events/${eventId}/availability`, { session: { accountId: shopper.session().accountId } }), (r) => `${r.status} ok`),
    },
    {
      title: 'Present my admission token from a different account',
      expect: '403 token_account_mismatch',
      run() {
        const { token } = shopper.session();
        if (!token) return NEEDS_TOKEN;
        return outcome(api.request('GET', `/events/${eventId}/availability`, { session: { accountId: 'acct_someone_else', token } }), (r) => `${r.status} ok`);
      },
    },
    {
      title: `Fire ${BURST_SIZE} requests at once on one token`,
      expect: 'about 10 succeed, the rest get 429 rate_limited',
      async run() {
        const session = shopper.session();
        if (!session.token) return NEEDS_TOKEN;
        const results = await Promise.all(Array.from({ length: BURST_SIZE }, () =>
          outcome(api.request('GET', `/events/${eventId}/availability`, { session, quiet: true }), () => 'ok')));
        const limited = results.filter((r) => r === '429 rate_limited').length;
        const ok = results.filter((r) => r === 'ok').length;
        const other = results.filter((r) => r !== 'ok' && r !== '429 rate_limited');
        return `${ok} succeeded, ${limited} got 429 rate_limited${other.length > 0 ? `, others: ${[...new Set(other)].join(', ')}` : ''}`;
      },
    },
    {
      title: 'Repeat my last hold request with the same Idempotency-Key',
      expect: 'the stored response again, marked Idempotent-Replay, and no second hold',
      run() {
        const last = shopper.lastHoldRequest();
        if (!last) return NEEDS_HOLD;
        if (!shopper.session().token) return NEEDS_TOKEN;
        return outcome(api.createHold(eventId, shopper.session(), last.key, last.selection),
          (r) => `${r.status}${r.replayed ? ', replayed' : ', NOT replayed'}, hold ${r.body.holdId.slice(0, 13)}…`);
      },
    },
    {
      title: 'Reuse that Idempotency-Key with a different body',
      expect: '422 idempotency_key_reused',
      run() {
        const last = shopper.lastHoldRequest();
        if (!last) return NEEDS_HOLD;
        if (!shopper.session().token) return NEEDS_TOKEN;
        const previous = last.selection.bestAvailable;
        const different = { bestAvailable: { section: previous?.section ?? sections[0], quantity: previous?.quantity === 1 ? 2 : 1 } };
        return outcome(api.createHold(eventId, shopper.session(), last.key, different), (r) => `${r.status} accepted`);
      },
    },
  ];

  const items = probes.map((probe) => {
    const result = h('p', { class: 'probe-result', role: 'status' });
    const runButton = h('button', { type: 'button', class: 'btn', text: 'Send' });
    runButton.addEventListener('click', async () => {
      runButton.disabled = true;
      try {
        result.textContent = `Got: ${await probe.run()}`;
      } catch (err) {
        result.textContent = `Failed: ${err.message}`;
      } finally {
        runButton.disabled = false;
      }
    });
    return h('li', { class: 'probe' },
      h('div', {}, h('p', { class: 'probe-title', text: probe.title }), h('p', { class: 'hint', text: `Expected: ${probe.expect}.` }), result),
      runButton);
  });

  return {
    element: h('section', { class: 'panel probes', 'aria-labelledby': 'probes-title' },
      h('header', { class: 'panel-head' },
        h('h2', { id: 'probes-title', text: 'Misbehave on purpose' }),
        h('p', { class: 'hint', text: 'Requests a correct client never sends. Each one lands in the request log.' })),
      h('ul', { class: 'probe-list' }, ...items)),
  };
}
