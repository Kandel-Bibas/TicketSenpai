"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, date, money } from "../../lib/api";
import { Loading, Notice } from "../../components/shell";

export default function Events() {
  const [events, setEvents] = useState(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setEvents(null);
    setError("");
    api(`/events?q=${encodeURIComponent(search)}&page=${page}`)
      .then((data) => {
        if (active) setEvents(data.items);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [search, page]);
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Good music. Your people. Be there.</p>
          <h1>
            Some nights
            <br />
            stay with you.
          </h1>
          <p className="lead">
            Find your next one. Live shows, great seats,
            <br className="desktop-break" /> and a little something to look
            forward to.
          </p>
          <a href="#shows" className="button primary">
            Find your next show <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div
          className="hero-ticket"
          aria-label="Featured show: After Hours, March 20"
        >
          <div className="ticket-top">
            <span>TicketSenpai presents</span>
            <span>01 / 03</span>
          </div>
          <div className="ticket-title">
            After
            <br />
            Hours<span aria-hidden="true">↗</span>
          </div>
          <div className="ticket-bottom">
            <span>
              The Midnight Assembly
              <br />
              <small>Mock Arena · Chicago</small>
            </span>
            <span>
              Mar 20
              <br />
              <small>2027</small>
            </span>
          </div>
          <div className="ticket-tear" />
          <div className="ticket-stub">
            <span>One night. All in.</span>
            <span className="barcode-art" aria-hidden="true" />
          </div>
        </div>
      </section>
      <section id="shows">
        <div className="section-head">
          <div>
            <p className="eyebrow">The calendar looks good</p>
            <h2>Find your frequency.</h2>
          </div>
          <span className="muted">Chicago, IL · 2027 season</span>
        </div>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query);
            setPage(1);
          }}
        >
          <label htmlFor="search">Search shows or artists</label>
          <div className="search-row">
            <input
              id="search"
              type="search"
              maxLength={300}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Who do you want to see?"
            />
            <button type="submit">Search ↗</button>
          </div>
        </form>
        <Notice>{error}</Notice>
        {!events && !error && <Loading />}
        {events?.length === 0 && (
          <div className="empty">
            <h3>No shows found.</h3>
            <p>Try another artist or show name.</p>
          </div>
        )}
        <div className="event-grid">
          {events?.map((event) => (
            <Link
              href={`/events/${event.id}`}
              className="event-card"
              key={event.id}
            >
              <div className={`event-poster poster-${(event.id - 1) % 3}`}>
                <span>{event.genre}</span>
                <h3>{event.name}</h3>
                <div>
                  <span>{date(event.starts_at)}</span>
                  <span aria-hidden="true">↗</span>
                </div>
              </div>
              <div className="event-copy">
                <h3>{event.artist}</h3>
                <p>{event.venue}</p>
                <div className="price-row">
                  <span>From {money(event.price_cents)}</span>
                  <span>Choose seats ↗</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {(page > 1 || events?.length === 20) && (
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={events?.length !== 20}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
      <section className="closing">
        <h2>
          Less planning.
          <br />
          More “remember that night?”
        </h2>
        <p>
          Pick your show. Find your spot.
          <br />
          We’ll keep your tickets in one place.
        </p>
      </section>
    </>
  );
}
