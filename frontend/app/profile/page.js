"use client";
import { useState } from "react";
import { api } from "../../lib/api";
import {
  Loading,
  Notice,
  SignInPrompt,
  useSession,
} from "../../components/shell";
export default function Profile() {
  const { user, loading, refresh } = useSession();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/me", {
        method: "PATCH",
        body: Object.fromEntries(new FormData(e.currentTarget)),
      });
      await refresh();
      setMessage("Your profile is saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Loading />;
  if (!user) return <SignInPrompt />;
  return (
    <div className="narrow">
      <p className="eyebrow">A little about you</p>
      <h1>Your profile.</h1>
      <form className="form-card" onSubmit={save}>
        <Notice>{error}</Notice>
        <Notice success>{message}</Notice>
        <label>
          Display name
          <input
            key={user.id}
            name="name"
            defaultValue={user.name}
            maxLength={80}
            required
          />
        </label>
        <div className="stat">
          <span>Email</span>
          <span>{user.email}</span>
        </div>
        <div className="stat">
          <span>Account</span>
          <span>{user.role}</span>
        </div>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}
