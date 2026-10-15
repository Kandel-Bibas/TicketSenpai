// Mock payment provider. Outcomes are chosen by the payment token, the way a
// real provider's test cards work:
//   tok_decline            → declined
//   tok_timeout_charged    → times out, but the card WAS authorised
//   tok_timeout_uncharged  → times out, and nothing was authorised
//   any other tok_*        → approved
// `setMode('down')` makes every call fail fast, which is what opens the breaker.

export const PSP_MODES = ['up', 'down'];

/**
 * @typedef {{ kind: 'approved' } | { kind: 'declined', reason: string } | { kind: 'timeout' } | { kind: 'unavailable' }} AuthorizeResult
 */

export function createMockPsp() {
  let mode = 'up';
  // idempotency key (= order id) → { status: 'authorized' | 'captured' | 'voided' | 'declined', amountCents, currency }
  const charges = new Map();

  return {
    setMode(next) {
      if (!PSP_MODES.includes(next)) throw new Error(`Unknown PSP mode "${next}"`);
      mode = next;
    },
    mode: () => mode,

    // A side-effect-free call, used to probe a half-open breaker when no payment is waiting.
    ping: () => (mode === 'down' ? { kind: 'unavailable' } : { kind: 'ok' }),

    /**
     * Idempotent by key: a repeated call returns the original outcome and never charges twice.
     * @returns {AuthorizeResult}
     */
    authorize({ idempotencyKey, amountCents, currency, paymentToken }) {
      if (mode === 'down') return { kind: 'unavailable' };

      const existing = charges.get(idempotencyKey);
      if (existing) {
        return existing.status === 'declined' ? { kind: 'declined', reason: 'card_declined' } : { kind: 'approved' };
      }
      if (paymentToken === 'tok_decline') {
        charges.set(idempotencyKey, { status: 'declined', amountCents, currency });
        return { kind: 'declined', reason: 'card_declined' };
      }
      if (paymentToken === 'tok_timeout_uncharged') return { kind: 'timeout' };

      charges.set(idempotencyKey, { status: 'authorized', amountCents, currency });
      return paymentToken === 'tok_timeout_charged' ? { kind: 'timeout' } : { kind: 'approved' };
    },

    /** @returns {{ kind: 'unavailable' } | { kind: 'not_found' } | { kind: 'found', status: string }} */
    lookup(idempotencyKey) {
      if (mode === 'down') return { kind: 'unavailable' };
      const charge = charges.get(idempotencyKey);
      if (!charge || charge.status === 'declined') return { kind: 'not_found' };
      return { kind: 'found', status: charge.status };
    },

    capture(idempotencyKey) {
      if (mode === 'down') return { kind: 'unavailable' };
      const charge = charges.get(idempotencyKey);
      if (!charge || (charge.status !== 'authorized' && charge.status !== 'captured')) return { kind: 'not_capturable' };
      charge.status = 'captured';
      return { kind: 'captured' };
    },

    // Voiding an unknown key is a no-op, so the reconciler can always call it.
    void(idempotencyKey) {
      if (mode === 'down') return { kind: 'unavailable' };
      const charge = charges.get(idempotencyKey);
      if (charge && charge.status === 'authorized') charge.status = 'voided';
      return { kind: 'voided' };
    },

    // The provider's ledger, as the invariant checker sees it.
    capturedKeys: () => [...charges].filter(([, c]) => c.status === 'captured').map(([key]) => key),
  };
}
