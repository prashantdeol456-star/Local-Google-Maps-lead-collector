import { useState, type FormEvent } from "react";
import { type BackendStatus } from "../../storage/auth";
import { BackendStatusBar } from "../components/BackendStatusBar";
import { backendClient } from "../services/backendClient";

interface Props {
  status: BackendStatus;
  onLoggedIn: (s: BackendStatus) => void;
  onRetry: () => void;
}

export function LoginPage({ status, onLoggedIn, onRetry }: Props) {
  const [backendUrl, setBackendUrl] = useState(status.backendUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await backendClient.login(backendUrl, email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPassword("");
    onLoggedIn(res.data);
  }

  return (
    <main className="panel">
      <header className="panel__header">
        <h1>Meta Helper</h1>
      </header>

      <BackendStatusBar status={status} onRetry={onRetry} />

      <form className="card form" onSubmit={submit}>
        <h2 className="form__title">Admin login</h2>
        <p className="form__hint">Use the same email and password as the admin panel.</p>

        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {showServer ? (
          <label className="field">
            <span>Backend URL</span>
            <input type="text" value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} spellCheck={false} />
          </label>
        ) : (
          <button type="button" className="link link--left" onClick={() => setShowServer(true)}>
            Backend: {backendUrl.replace(/^https?:\/\//, "")} · change
          </button>
        )}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
