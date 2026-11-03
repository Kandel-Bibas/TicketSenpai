"use client";
import { useEffect, useState } from "react";
import { api, money } from "../../lib/api";
import {
  Loading,
  Notice,
  SignInPrompt,
  useSession,
} from "../../components/shell";
const blank = {
  name: "",
  artist: "",
  venue: "Mock Arena · Chicago",
  starts_at: "2027-07-01T20:00",
  genre: "",
  description: "",
  price: "65.00",
  published: true,
};
export default function Admin() {
  const { user, loading } = useSession();
  const [events, setEvents] = useState(null);
  const [edit, setEdit] = useState(blank);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setEvents((await api(`/admin/events?page=${page}`)).items);
  }
  useEffect(() => {
    if (user?.role === "admin") load().catch((err) => setError(err.message));
  }, [user?.id, page]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(edit.id ? `/admin/events/${edit.id}` : "/admin/events", {
        method: edit.id ? "PUT" : "POST",
        body: {
          ...edit,
          price_cents: Math.round(Number(edit.price) * 100),
          starts_at: `${edit.starts_at}:00Z`,
          published: !!edit.published,
        },
      });
      setMessage(edit.id ? "Event updated." : "Event created with 270 seats.");
      setEdit(blank);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (!user) return <SignInPrompt />;
  if (user.role !== "admin")
    return <Notice>Administrator access is required.</Notice>;
  return (
    <>
      <p className="eyebrow">Behind the scenes</p>
      <h1>Make the night happen.</h1>
      <Notice>{error}</Notice>
      <Notice success>{message}</Notice>
      <div className="admin-layout">
        <section>
          <h2>Your events</h2>
          {!events && !error && <Loading />}
          {events?.map((event) => (
            <button
              className="admin-event"
              key={event.id}
              onClick={() => {
                setEdit({
                  ...event,
                  starts_at: new Date(event.starts_at)
                    .toISOString()
                    .slice(0, 16),
                  price: (event.price_cents / 100).toFixed(2),
                  published: !!event.published,
                });
                setMessage("");
              }}
            >
              <span>
                {event.name}
                <small>
                  {event.published ? "Published" : "Draft"} · From{" "}
                  {money(event.price_cents)}
                </small>
              </span>
              <span>Edit ↗</span>
            </button>
          ))}
          {(page > 1 || events?.length === 20) && (
            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>{page}</span>
              <button
                disabled={events?.length !== 20}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
        <form className="form-card" onSubmit={submit}>
          <div className="section-head">
            <h2>{edit.id ? "Edit event" : "New event"}</h2>
            {edit.id && (
              <button type="button" onClick={() => setEdit(blank)}>
                New event
              </button>
            )}
          </div>
          {[
            ["name", "Show name"],
            ["artist", "Artist"],
            ["venue", "Venue"],
            ["starts_at", "Date and time (UTC)"],
            ["genre", "Genre"],
            ["price", "Standard seat price ($)"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                required
                type={
                  key === "price"
                    ? "number"
                    : key === "starts_at"
                      ? "datetime-local"
                      : "text"
                }
                min={key === "price" ? 1 : undefined}
                max={key === "price" ? 10000 : undefined}
                step={key === "price" ? "0.01" : undefined}
                value={edit[key]}
                onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            Description
            <textarea
              required
              maxLength={2000}
              value={edit.description}
              onChange={(e) =>
                setEdit({ ...edit, description: e.target.value })
              }
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={edit.published}
              onChange={(e) =>
                setEdit({ ...edit, published: e.target.checked })
              }
            />
            Published
          </label>
          <p className="fine">
            Premium seats add $90; GA adds $25. Prices lock once seats are held
            or sold.
          </p>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : edit.id ? "Save event" : "Create event"}
          </button>
        </form>
      </div>
    </>
  );
}
