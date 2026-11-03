"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api, date, money } from "../../../lib/api";
import {
  Loading,
  Notice,
  SignInPrompt,
  useSession,
} from "../../../components/shell";
export default function Order({ params }) {
  const { id } = use(params);
  const { user, loading } = useSession();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setOrder(null);
    setError("");
    if (!user) return;
    let active = true;
    api(`/orders/${id}`)
      .then((data) => {
        if (active) setOrder(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [id, user?.id]);
  if (loading) return <Loading />;
  if (!user) return <SignInPrompt />;
  return (
    <>
      <Link className="back" href="/tickets">
        ← My tickets
      </Link>
      <Notice>{error}</Notice>
      {!order && !error && <Loading />}
      {order && (
        <div className="narrow">
          <p className="eyebrow">
            Order #{order.id} · {order.status}
          </p>
          <h1>
            {order.status === "confirmed" ? "You’re going." : "Not quite yet."}
          </h1>
          <div className="order-detail">
            <h2>{order.event_name}</h2>
            <p>
              {date(order.starts_at)} · {order.venue}
            </p>
            <div className="stat">
              <span>Booked by</span>
              <span>{order.buyer_name}</span>
            </div>
            <div className="stat">
              <span>Total</span>
              <span>{money(order.total_cents)}</span>
            </div>
            {order.tickets.map((ticket) => (
              <div className="admission-ticket" key={ticket.seat_id}>
                <span>Admit one</span>
                <h3>{ticket.seat_id}</h3>
                <code>{ticket.barcode}</code>
                <span className="barcode-art" aria-hidden="true" />
              </div>
            ))}
            {order.status === "declined" && (
              <p>No tickets were issued. Return to the event to try again.</p>
            )}
            <Link className="button" href={`/events/${order.event_id}`}>
              Back to show
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
