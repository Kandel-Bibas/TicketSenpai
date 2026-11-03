"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, date, money } from "../../lib/api";
import {
  Loading,
  Notice,
  SignInPrompt,
  useSession,
} from "../../components/shell";
export default function Tickets() {
  const { user, loading } = useSession();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setOrders(null);
    setError("");
    if (!user) return;
    let active = true;
    api(`/orders?page=${page}`)
      .then((data) => {
        if (active) setOrders(data.items);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [user?.id, page]);
  if (loading) return <Loading />;
  if (!user) return <SignInPrompt />;
  return (
    <>
      <p className="eyebrow">Something to look forward to</p>
      <h1>Your next nights out.</h1>
      <Notice>{error}</Notice>
      {!orders && !error && <Loading />}
      {orders?.length === 0 && (
        <div className="empty">
          <h2>Your calendar has room.</h2>
          <p>Find a show and make a night of it.</p>
          <Link className="button primary" href="/events">
            Explore shows ↗
          </Link>
        </div>
      )}
      <div className="order-list">
        {orders?.map((order) => (
          <Link
            className="order-row"
            href={`/tickets/${order.id}`}
            key={order.id}
          >
            <span className="order-date">{date(order.starts_at)}</span>
            <div>
              <h2>{order.event_name}</h2>
              <p>{order.venue}</p>
              <span>
                {order.status === "confirmed"
                  ? `${order.tickets.length} tickets · Confirmed`
                  : "Payment declined"}
              </span>
            </div>
            <span>{money(order.total_cents)} ↗</span>
          </Link>
        ))}
      </div>
      {(page > 1 || orders?.length === 20) && (
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={orders?.length !== 20}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
