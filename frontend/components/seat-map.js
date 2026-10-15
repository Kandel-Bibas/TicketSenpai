"use client";
import { money } from "../lib/api";

// React port of web/js/seatMap.js: reserved grids, GA, state labels, keyboard movement.
export default function SeatMap({
  seats,
  selected,
  onChange,
  held = [],
  disabled = false,
}) {
  function toggle(seat) {
    if (disabled || seat.status !== "available") return;
    if (selected.includes(seat.id))
      onChange(selected.filter((id) => id !== seat.id));
    else if (selected.length < 6) onChange([...selected, seat.id]);
  }
  function move(event, perRow) {
    const delta = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -perRow,
      ArrowDown: perRow,
    }[event.key];
    if (delta === undefined) return;
    const buttons = [...event.currentTarget.querySelectorAll("button.seat")];
    const next = buttons[buttons.indexOf(event.target) + delta];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
  const ga = seats.filter((s) => s.section === "GA");
  return (
    <div className="venue">
      <div className="stage">Stage / front of house</div>
      <section className="ga-section">
        <div className="section-label">
          <h3>GA floor</h3>
          <span>{money(ga[0]?.price_cents || 0)} · Standing</span>
        </div>
        <div className="ga-texture" aria-hidden="true" />
        <div className="ga-controls">
          <span>
            {ga.filter((s) => s.status === "available").length} spots available
          </span>
          <label>
            Quantity
            <select
              aria-label="General admission quantity"
              disabled={disabled}
              value={selected.filter((id) => id.startsWith("GA-")).length}
              onChange={(e) => {
                const other = selected.filter((id) => !id.startsWith("GA-"));
                const count = Number(e.target.value);
                onChange([
                  ...other,
                  ...ga
                    .filter((s) => s.status === "available")
                    .slice(0, count)
                    .map((s) => s.id),
                ]);
              }}
            >
              {Array.from(
                {
                  length:
                    Math.min(
                      6 - selected.filter((id) => !id.startsWith("GA-")).length,
                      ga.filter((s) => s.status === "available").length,
                    ) + 1,
                },
                (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
      </section>
      {["A", "B"].map((section) => {
        const group = seats.filter((s) => s.section === section);
        const perRow = section === "A" ? 10 : 12;
        return (
          <section key={section} className="reserved-section">
            <div className="section-label">
              <h3>Section {section}</h3>
              <span>{money(group[0]?.price_cents || 0)} · Reserved</span>
            </div>
            <div
              className="seat-grid"
              role="group"
              aria-label={`Section ${section} seats`}
              style={{ "--columns": perRow }}
              onKeyDown={(e) => move(e, perRow)}
            >
              {group.map((seat) => {
                const mine = held.includes(seat.id);
                const chosen = selected.includes(seat.id);
                return (
                  <button
                    key={seat.id}
                    type="button"
                    className="seat"
                    data-status={
                      mine ? "mine" : chosen ? "selected" : seat.status
                    }
                    aria-label={`Section ${section}, row ${seat.row_number}, seat ${seat.seat_number}, ${mine ? "yours" : seat.status}`}
                    aria-pressed={chosen}
                    aria-disabled={disabled || seat.status !== "available"}
                    onClick={() => toggle(seat)}
                    title={`Row ${seat.row_number}, seat ${seat.seat_number}`}
                  >
                    {seat.seat_number}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <ul className="legend">
        <li>
          <i className="seat" data-status="available" />
          Available
        </li>
        <li>
          <i className="seat" data-status="selected" />
          Selected / yours
        </li>
        <li>
          <i className="seat" data-status="held" />
          Held
        </li>
        <li>
          <i className="seat" data-status="sold" />
          Sold
        </li>
      </ul>
    </div>
  );
}
