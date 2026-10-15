export const DEMO_EVENT_ID = 'evt_demo_stadium';

/**
 * One small event: two reserved sections and a general-admission floor whose
 * tickets are pre-materialised as rows, as the design requires.
 * @param {ReturnType<import('./catalog.js').createCatalog>} catalog
 * @param {{ onSaleAt: number }} options
 */
export function seedDemoEvent(catalog, { onSaleAt }) {
  const seats = [];
  const reserved = (section, priceTier, rows, perRow) => {
    for (let r = 1; r <= rows; r++) {
      for (let n = 1; n <= perRow; n++) {
        seats.push({ seatId: `${section}-${r}-${n}`, section, row: String(r), number: n, priceTier });
      }
    }
  };
  reserved('A', 'premium', 5, 10);
  reserved('B', 'standard', 10, 12);
  for (let i = 1; i <= 100; i++) {
    seats.push({ seatId: `GA-${i}`, section: 'GA', row: null, number: null, priceTier: 'floor' });
  }

  catalog.addEvent(
    {
      eventId: DEMO_EVENT_ID,
      name: 'Demo Stadium Night',
      venue: 'Mock Arena',
      startsAt: onSaleAt + 90 * 24 * 60 * 60 * 1000,
      onSaleAt,
      seatLimitPerAccount: 6,
      currency: 'USD',
      priceTiers: { premium: 18500, standard: 9500, floor: 12000 },
      sections: [
        { section: 'A', priceTier: 'premium', generalAdmission: false },
        { section: 'B', priceTier: 'standard', generalAdmission: false },
        { section: 'GA', priceTier: 'floor', generalAdmission: true },
      ],
    },
    seats,
  );
}
