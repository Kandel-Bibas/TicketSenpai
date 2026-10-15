import { ApiError } from './errors.js';

/**
 * @typedef {{
 *   eventId: string, name: string, venue: string, startsAt: number, onSaleAt: number,
 *   seatLimitPerAccount: number, currency: string,
 *   priceTiers: Record<string, number>,   // tier → price in minor units
 *   sections: { section: string, priceTier: string, generalAdmission: boolean }[]
 * }} Event
 */

/** @param {{ store: ReturnType<import('./store.js').createStore> }} deps */
export function createCatalog({ store }) {
  return {
    /** @param {Event} event @param {{ seatId: string, section: string, row: string | null, number: number | null, priceTier: string }[]} seats */
    addEvent(event, seats) {
      store.events.set(event.eventId, event);
      store.insertSeats(event.eventId, seats);
    },

    /** @returns {Event} */
    getEvent(eventId) {
      const event = store.events.get(eventId);
      if (!event) throw new ApiError(404, 'event_not_found', `No event with id ${eventId}`);
      return event;
    },

    allEvents: () => [...store.events.values()],

    listEvents({ limit, cursor }) {
      const sorted = [...store.events.values()].sort((a, b) => a.eventId.localeCompare(b.eventId));
      const start = cursor === null ? 0 : sorted.findIndex((e) => e.eventId > cursor);
      const page = start === -1 ? [] : sorted.slice(start, start + limit);
      const hasMore = start !== -1 && start + limit < sorted.length;
      return { items: page, nextCursor: hasMore ? page[page.length - 1].eventId : null };
    },

    // Immutable per event, so the edge can cache it for a long time.
    seatMap(eventId) {
      const event = this.getEvent(eventId);
      const seats = store.listSeats(eventId);
      return {
        eventId,
        sections: event.sections.map((s) => ({
          ...s,
          priceCents: event.priceTiers[s.priceTier],
          seats: seats
            .filter((seat) => seat.section === s.section)
            .map(({ seatId, row, number }) => ({ seatId, row, number })),
        })),
      };
    },
  };
}
