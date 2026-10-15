"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

const Session = createContext(null);
export const useSession = () => useContext(Session);

export function Shell({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState("");
  const path = usePathname();
  async function refresh() {
    setError("");
    try {
      setUser(await api("/me"));
    } catch (err) {
      setUser(null);
      if (err.status !== 401) setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    const saved = localStorage.getItem("ticketsenpai-theme");
    if (saved) {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);
  function toggleTheme() {
    const dark = theme
      ? theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ticketsenpai-theme", next);
  }
  async function logout() {
    try {
      await api("/logout", { method: "POST" });
      setUser(null);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Session.Provider value={{ user, loading, refresh }}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link href="/events" className="brand" aria-label="TicketSenpai home">
          <span className="brand-mark" aria-hidden="true">
            t/s
          </span>
          TicketSenpai
        </Link>
        <nav aria-label="Main navigation">
          <Link
            aria-current={path.startsWith("/events") ? "page" : undefined}
            href="/events"
          >
            Explore
          </Link>
          <Link
            aria-current={path.startsWith("/tickets") ? "page" : undefined}
            href="/tickets"
          >
            My tickets
          </Link>
          {user?.role === "admin" && <Link href="/admin">Manage events</Link>}
        </nav>
        <div className="account-nav">
          <button
            className="quiet"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
          >
            ◐ <span>Theme</span>
          </button>
          {user ? (
            <>
              <Link href="/profile">{user.name}</Link>
              <button className="quiet" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login">Sign in ↗</Link>
          )}
        </div>
      </header>
      {error && (
        <div className="shell-error">
          <Notice>{error}</Notice>
        </div>
      )}
      <main id="main">{children}</main>
      <footer>
        <span>TicketSenpai · Your next great night.</span>
        <span>Local learning edition · Simulated purchases</span>
      </footer>
    </Session.Provider>
  );
}
export function Notice({ children, success = false }) {
  return children ? (
    <p
      className={success ? "notice success" : "notice"}
      role={success ? "status" : "alert"}
    >
      {children}
    </p>
  ) : null;
}
export function Loading() {
  return (
    <p className="loading" role="status">
      Loading…
    </p>
  );
}
export function SignInPrompt() {
  return (
    <div className="empty">
      <h2>Make it your night.</h2>
      <p>Sign in to reserve seats and find your tickets.</p>
      <Link className="button primary" href="/login">
        Sign in
      </Link>
    </div>
  );
}
