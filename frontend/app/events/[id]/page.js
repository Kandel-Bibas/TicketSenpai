"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, date, money } from "../../../lib/api";
import { Loading, Notice, useSession } from "../../../components/shell";
import SeatMap from "../../../components/seat-map";

export default function Event({ params }) {
  const { id } = use(params);
  const { user } = useSession();
  const router = useRouter();
  const [event, setEvent] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [hold, setHold] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [payment, setPayment] = useState("approve");
  const [review, setReview] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const holdRequest = useRef(null);
  const orderRequest = useRef(null);
  async function refresh() {
    const data = await api(`/events/${id}`);
    setEvent(data);
    return data;
  }
  async function loadReviews() {
    setReviews((await api(`/events/${id}/reviews?page=${reviewPage}`)).items);
  }
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const data = await api(`/events/${id}`);
        if (active) setEvent(data);
      } catch (err) {
        if (active) setError(err.message);
      }
    }
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  useEffect(() => {
    loadReviews().catch((err) => setError(err.message));
  }, [id, reviewPage]);
  useEffect(() => {
    let active = true;
    setHold(null);
    setSelected([]);
    holdRequest.current = null;
    orderRequest.current = null;
    if (user) {
      setBusy(true);
      api(`/events/${id}/hold`)
        .then((data) => {
          if (active) setHold(data.hold);
        })
        .catch((err) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    } else setBusy(false);
    return () => {
      active = false;
    };
  }, [user?.id, id]);
  useEffect(() => {
    if (!hold) return;
    const tick = () =>
      setRemaining(
        Math.max(0, hold.expires_at - Math.floor(Date.now() / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [hold]);
  function select(ids) {
    setSelected(ids);
    holdRequest.current = null;
    setError("");
  }
  async function reserve() {
    setBusy(true);
    setError("");
    setMessage("");
    const payload = { seat_ids: selected };
    if (!holdRequest.current)
      holdRequest.current = { key: crypto.randomUUID(), body: payload };
    try {
      const result = await api(`/events/${id}/holds`, {
        method: "POST",
        ...holdRequest.current,
      });
      setHold(result);
      await refresh();
    } catch (err) {
      setError(err.message);
      if (err.status) holdRequest.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function changeSeats() {
    setBusy(true);
    setError("");
    try {
      await api(`/holds/${hold.id}`, { method: "DELETE" });
      setHold(null);
      setSelected([]);
      holdRequest.current = null;
      orderRequest.current = null;
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function buy() {
    setBusy(true);
    setError("");
    setMessage("");
    if (!orderRequest.current)
      orderRequest.current = {
        key: crypto.randomUUID(),
        body: { hold_id: hold.id, payment },
      };
    try {
      const order = await api("/orders", {
        method: "POST",
        ...orderRequest.current,
      });
      orderRequest.current = null;
      if (order.status === "declined")
        setError(
          "Payment declined. Your seats remain held; choose Approved to try again.",
        );
      else router.push(`/tickets/${order.id}`);
    } catch (err) {
      setError(err.message);
      if (err.status) orderRequest.current = null;
    } finally {
      setBusy(false);
    }
  }
  async function postReview(e) {
    e.preventDefault();
    setReviewBusy(true);
    setError("");
    try {
      await api(`/events/${id}/reviews`, {
        method: "POST",
        body: { body: review },
      });
      setReview("");
      setMessage("Your review is posted.");
      if (reviewPage === 1) await loadReviews();
      else setReviewPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewBusy(false);
    }
  }
  if (!event)
    return (
      <>
        <Notice>{error}</Notice>
        {!error && <Loading />}
      </>
    );
  const total = event.seats
    .filter((s) => selected.includes(s.id))
    .reduce((sum, s) => sum + s.price_cents, 0);
  return (
    <>
      <Link className="back" href="/events">
        ← All shows
      </Link>
      <header className="event-header">
        <div>
          <p className="eyebrow">
            {event.genre} · {date(event.starts_at)}
          </p>
          <h1>{event.name}</h1>
          <p className="lead">{event.artist}</p>
          <p>{event.venue}</p>
        </div>
        <div className="event-number" aria-hidden="true">
          0{id}
          <span>/ Live</span>
        </div>
      </header>
      <p className="event-description">{event.description}</p>
      <div className="booking-layout">
        <section>
          <div className="section-head">
            <h2>Find your spot.</h2>
            <span className="muted">Up to 6 tickets per person</span>
          </div>
          <SeatMap
            seats={event.seats}
            selected={selected}
            onChange={select}
            held={hold?.seat_ids}
            disabled={!!hold || busy}
          />
        </section>
        <aside className="booking">
          <p className="eyebrow">Your night, reserved</p>
          <h2>{hold ? "Almost there." : "Good seats await."}</h2>
          <Notice>{error}</Notice>
          <Notice success>{message}</Notice>
          {hold ? (
            <>
              <div className="stat">
                <span>Hold expires in</span>
                <strong>
                  {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </strong>
              </div>
              <p className="seat-list">{hold.seat_ids.join(" · ")}</p>
              <div className="stat total">
                <span>Total</span>
                <span>{money(hold.total_cents)}</span>
              </div>
              {remaining > 0 ? (
                <>
                  <label>
                    Simulated payment
                    <select
                      disabled={busy}
                      value={payment}
                      onChange={(e) => {
                        setPayment(e.target.value);
                        orderRequest.current = null;
                      }}
                    >
                      <option value="approve">Approved</option>
                      <option value="decline">Declined (demo)</option>
                    </select>
                  </label>
                  <p className="fine">
                    No card details needed. No real charge.
                  </p>
                  <button
                    className="primary wide"
                    disabled={busy}
                    onClick={buy}
                  >
                    {busy ? "Working…" : "Confirm purchase ↗"}
                  </button>
                </>
              ) : (
                <Notice>Your hold expired. Choose your seats again.</Notice>
              )}
              <button className="wide" disabled={busy} onClick={changeSeats}>
                Choose different seats
              </button>
            </>
          ) : (
            <>
              <p>
                Select seats on the map or choose a quantity on the GA floor.
              </p>
              <div className="stat">
                <span>Tickets selected</span>
                <span>{selected.length} / 6</span>
              </div>
              {selected.length > 0 && (
                <p className="seat-list">{selected.join(" · ")}</p>
              )}
              <div className="stat total">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
              {user ? (
                <button
                  className="primary wide"
                  disabled={busy || selected.length === 0}
                  onClick={reserve}
                >
                  {busy ? "Reserving…" : "Hold my seats ↗"}
                </button>
              ) : (
                <Link className="button primary wide" href="/login">
                  Sign in to reserve ↗
                </Link>
              )}
              <p className="fine">
                Your seats are held for 8 minutes while you check out.
              </p>
            </>
          )}
        </aside>
      </div>
      <section className="reviews">
        <div className="section-head">
          <h2>Before the encore.</h2>
          <span className="muted">The conversation starts here</span>
        </div>
        {user ? (
          <form onSubmit={postReview}>
            <label htmlFor="review">Leave a note for the crowd</label>
            <textarea
              id="review"
              required
              maxLength={2000}
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Who's coming with you?"
            />
            <button disabled={reviewBusy || !review.trim()}>
              {reviewBusy ? "Posting…" : "Post review"}
            </button>
          </form>
        ) : (
          <p>
            <Link href="/login">Sign in</Link> to join the conversation.
          </p>
        )}
        {reviews.length === 0 && (
          <p className="muted">Be the first to leave a review.</p>
        )}
        {reviews.map((item) => (
          <article className="review" key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <span className="muted">{date(item.created_at * 1000)}</span>
            </div>
            {/* LAB V02: intentionally unsanitized HTML for stored-XSS coursework. */}
            <div dangerouslySetInnerHTML={{ __html: item.body }} />
          </article>
        ))}
        {(reviewPage > 1 || reviews.length === 20) && (
          <div className="pagination">
            <button
              disabled={reviewPage === 1}
              onClick={() => setReviewPage(reviewPage - 1)}
            >
              Previous
            </button>
            <span>Page {reviewPage}</span>
            <button
              disabled={reviews.length !== 20}
              onClick={() => setReviewPage(reviewPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}
