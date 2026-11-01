import { useState, type FormEvent } from "react";
import { ErrorBox } from "../components/ui";
import { api } from "../lib/api";

function Brand({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">LP</span>
      <div>
        <h1 className="font-semibold text-slate-900 dark:text-white">Lead Platform</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

const shell = "flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 dark:bg-slate-950";

function RegisterForm({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({ email: "", phone: "", username: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError(new Error("The passwords do not match"));
    setBusy(true);
    setError(null);
    try {
      await api("/auth/register", { method: "POST", body: { email: form.email, phone: form.phone, username: form.username, password: form.password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card w-full max-w-sm space-y-4 p-6">
        <Brand subtitle="Account request sent" />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Thank you. Your account is waiting for approval by the administrator. You can sign in with your user id <strong>{form.username.toLowerCase()}</strong> or
          email once it is approved.
        </p>
        <button type="button" className="btn btn-primary w-full" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
      <Brand subtitle="Create an account" />
      <label className="block space-y-1">
        <span className="label">Email</span>
        <input className="input" type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={set("email")} />
      </label>
      <label className="block space-y-1">
        <span className="label">Phone number</span>
        <input className="input" type="tel" autoComplete="tel" required minLength={7} maxLength={20} pattern="\+?[0-9 ()\-]+" value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
      </label>
      <label className="block space-y-1">
        <span className="label">User id</span>
        <input
          className="input"
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}"
          title="3–32 characters: letters, digits, dot, dash or underscore"
          value={form.username}
          onChange={set("username")}
          placeholder="e.g. ravi.shop"
        />
      </label>
      <label className="block space-y-1">
        <span className="label">Password (at least 10 characters)</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={form.password} onChange={set("password")} />
      </label>
      <label className="block space-y-1">
        <span className="label">Repeat password</span>
        <input className="input" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={form.confirm} onChange={set("confirm")} />
      </label>
      {error !== null && <ErrorBox error={error} />}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Sending…" : "Create account"}
      </button>
      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <button type="button" className="text-brand-600 hover:underline" onClick={onBack}>
          Sign in
        </button>
      </p>
    </form>
  );
}

export function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">(() => (window.location.pathname.endsWith("/register") ? "register" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "register") return <div className={shell}><RegisterForm onBack={() => setMode("login")} /></div>;

  return (
    <div className={shell}>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <a href="/" className="text-sm text-slate-500 hover:text-brand-600">
          ← Back to the website
        </a>
        <Brand subtitle="Sign in" />
        <label className="block space-y-1">
          <span className="label">Email or user id</span>
          <input className="input" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="label">Password</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error !== null && <ErrorBox error={error} />}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-sm text-slate-500">
          New here?{" "}
          <button type="button" className="text-brand-600 hover:underline" onClick={() => setMode("register")}>
            Create an account
          </button>
        </p>
      </form>
    </div>
  );
}
