import { h, money } from './dom.js';

const STATUS_WORDS = { available: 'available', held: 'held by a shopper', sold: 'sold', unknown: 'status hidden until you are admitted' };

/**
 * The venue. Geometry comes from the public seat map; statuses arrive later from
 * the token-gated availability view, so every seat starts as "unknown".
 * Reserved seats are buttons; the general-admission floor is a read-only field of
 * dots, because GA is bought through best-available rather than by picking a spot.
 * @param {{
 *   seatMap: { sections: { section: string, priceTier: string, generalAdmission: boolean, priceCents: number, seats: { seatId: string, row: string | null, number: number | null }[] }[] },
 *   currency: string,
 *   seatLimit: number,
 *   onSelectionChange: (change: { seatIds: string[], lostSeatIds: string[] }) => void
 * }} options
 */
export function createSeatMap({ seatMap, currency, seatLimit, onSelectionChange }) {
  /** @type {Map<string, { el: HTMLElement, section: string, label: string, status: string }>} */
  const seats = new Map();
  const selected = new Set();
  let mine = new Set();
  let interactive = false;

  const legendCounts = { available: h('span', { class: 'num' }), held: h('span', { class: 'num' }), sold: h('span', { class: 'num' }) };
  const gaSummaries = new Map();

  function paint(seatId) {
    const seat = seats.get(seatId);
    seat.el.dataset.status = seat.status;
    seat.el.dataset.mine = String(mine.has(seatId));
    if (seat.el.tagName === 'BUTTON') {
      const isSelected = selected.has(seatId);
      seat.el.setAttribute('aria-pressed', String(isSelected));
      seat.el.setAttribute('aria-disabled', String(!interactive || (seat.status !== 'available' && !isSelected)));
      seat.el.setAttribute('aria-label', `${seat.label}, ${mine.has(seatId) ? 'yours' : STATUS_WORDS[seat.status]}`);
      seat.el.title = seat.label;
    }
  }

  function toggle(seatId) {
    const seat = seats.get(seatId);
    if (!interactive) return;
    if (selected.has(seatId)) selected.delete(seatId);
    else if (seat.status === 'available' && selected.size < seatLimit) selected.add(seatId);
    else return;
    paint(seatId);
    onSelectionChange({ seatIds: [...selected], lostSeatIds: [] });
  }

  // Arrow keys move within a section's grid; only one seat per section is in the tab order.
  function onGridKeydown(event, buttons, perRow) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow }[event.key];
    if (step === undefined) return;
    const next = buttons[buttons.indexOf(event.target) + step];
    if (!next) return;
    event.preventDefault();
    event.target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  function reservedSection(section) {
    const rows = new Map();
    for (const seat of section.seats) {
      if (!rows.has(seat.row)) rows.set(seat.row, []);
      rows.get(seat.row).push(seat);
    }
    const perRow = Math.max(...[...rows.values()].map((row) => row.length));
    const buttons = [];
    const grid = h('div', { class: 'seat-grid', style: `--per-row:${perRow}`, role: 'group', 'aria-label': `Section ${section.section} seats` });
    for (const [row, rowSeats] of rows) {
      grid.append(h('span', { class: 'row-label', 'aria-hidden': 'true', text: row }));
      for (const seat of rowSeats.sort((a, b) => a.number - b.number)) {
        const el = h('button', { type: 'button', class: 'seat', tabindex: buttons.length === 0 ? 0 : -1, onClick: () => toggle(seat.seatId) });
        buttons.push(el);
        seats.set(seat.seatId, { el, section: section.section, label: `Section ${section.section}, row ${row}, seat ${seat.number}`, status: 'unknown' });
        grid.append(el);
      }
    }
    grid.addEventListener('keydown', (event) => onGridKeydown(event, buttons, perRow));
    return grid;
  }

  function generalAdmission(section) {
    const field = h('div', { class: 'ga-field', role: 'img' });
    for (const seat of section.seats) {
      const el = h('span', { class: 'seat seat-ga' });
      seats.set(seat.seatId, { el, section: section.section, label: `Section ${section.section}`, status: 'unknown' });
      field.append(el);
    }
    gaSummaries.set(section.section, field);
    return field;
  }

  // Stage first, then the floor, then reserved sections from the dearest outwards.
  const ordered = [...seatMap.sections].sort((a, b) => Number(b.generalAdmission) - Number(a.generalAdmission) || b.priceCents - a.priceCents);
  const element = h('div', { class: 'venue' },
    h('div', { class: 'stage', 'aria-hidden': 'true', text: 'Stage' }),
    ...ordered.map((section) => h('section', { class: 'venue-section', 'aria-label': `Section ${section.section}` },
      h('header', { class: 'venue-section-head' },
        h('h3', { text: section.generalAdmission ? `${section.section} floor` : `Section ${section.section}` }),
        h('span', { class: 'venue-section-price', text: `${section.priceTier}, ${money(section.priceCents, currency)}${section.generalAdmission ? ', standing' : ''}` }),
      ),
      section.generalAdmission ? generalAdmission(section) : reservedSection(section),
    )),
    h('ul', { class: 'legend', 'aria-label': 'Seat status legend' },
      h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'available' } }), 'Available ', legendCounts.available),
      h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'held' } }), 'Held ', legendCounts.held),
      h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'sold' } }), 'Sold ', legendCounts.sold),
      h('li', {}, h('span', { class: 'seat swatch', dataset: { status: 'held', mine: 'true' } }), 'Yours'),
    ),
  );

  function repaintAll() {
    const counts = { available: 0, held: 0, sold: 0, unknown: 0 };
    const gaAvailable = new Map();
    for (const [seatId, seat] of seats) {
      paint(seatId);
      counts[seat.status] += 1;
      if (gaSummaries.has(seat.section) && seat.status === 'available') gaAvailable.set(seat.section, (gaAvailable.get(seat.section) ?? 0) + 1);
    }
    const known = counts.unknown === 0;
    for (const status of ['available', 'held', 'sold']) legendCounts[status].textContent = known ? String(counts[status]) : '';
    for (const [section, field] of gaSummaries) {
      field.setAttribute('aria-label', known
        ? `Section ${section} floor: ${gaAvailable.get(section) ?? 0} of ${field.childElementCount} spots available`
        : `Section ${section} floor: ${field.childElementCount} spots, status hidden until you are admitted`);
    }
  }
  repaintAll();

  return {
    element,

    /** @param {{ seatId: string, status: string }[]} view rows from GET /availability */
    setStatuses(view) {
      for (const { seatId, status } of view) {
        const seat = seats.get(seatId);
        if (!seat) throw new Error(`Availability lists seat ${seatId}, which is not in the seat map`);
        seat.status = status;
      }
      const lostSeatIds = [...selected].filter((seatId) => seats.get(seatId).status !== 'available');
      lostSeatIds.forEach((seatId) => selected.delete(seatId));
      repaintAll();
      if (lostSeatIds.length > 0) onSelectionChange({ seatIds: [...selected], lostSeatIds });
    },

    clearStatuses() {
      for (const seat of seats.values()) seat.status = 'unknown';
      repaintAll();
    },

    /** Seats this shopper holds or has bought. */
    setMine(seatIds) {
      mine = new Set(seatIds);
      repaintAll();
    },

    setInteractive(value) {
      interactive = value;
      element.dataset.interactive = String(value);
      repaintAll();
    },

    clearSelection() {
      selected.clear();
      repaintAll();
    },

    priceOf(seatIds) {
      const priceBySection = new Map(seatMap.sections.map((s) => [s.section, s.priceCents]));
      return seatIds.reduce((sum, seatId) => sum + priceBySection.get(seats.get(seatId).section), 0);
    },
  };
}
