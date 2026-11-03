"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../lib/api";
import { Notice, useSession } from "./shell";
export default function AuthForm({ register = false }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const router = useRouter();
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (register) await api("/register", { method: "POST", body: fields });
      await api("/login", { method: "POST", body: fields });
      await refresh();
      router.push("/events");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <div>
        <p className="eyebrow">Your next great night starts here</p>
        <h1>
          {register ? (
            <>
              Your people.
              <br />
              Your place.
            </>
          ) : (
            <>
              Back for
              <br />
              the encore?
            </>
          )}
        </h1>
        <p className="lead">
          A seat with your name on it.
          <br />A show you won’t forget.
        </p>
      </div>
      <form className="form-card" onSubmit={submit}>
        <h2>{register ? "Create your account" : "Welcome back."}</h2>
        <Notice>{error}</Notice>
        {register && (
          <label>
            Your name
            <input name="name" autoComplete="name" maxLength={80} required />
          </label>
        )}
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={register ? 8 : undefined}
            maxLength={100}
            required
          />
        </label>
        <button className="primary wide" disabled={busy}>
          {busy ? "One moment…" : register ? "Create account ↗" : "Sign in ↗"}
        </button>
        <p>
          {register ? "Already have an account?" : "First time here?"}{" "}
          <Link href={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create an account"}
          </Link>
        </p>
        <div className="demo-note">
          Local demo account
          <br />
          <code>alice@example.test</code>
          <br />
          <code>alice-demo</code>
        </div>
      </form>
    </div>
  );
}
