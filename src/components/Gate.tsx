"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";

/* The door. Nothing in Circuit renders until somebody is behind it.

   This is a client gate, so it is not the security — every API route checks the session for
   itself, and that is what actually protects the data. This exists so the app does not show a
   shell full of failed requests to someone who simply needs to sign in. */

export type Me = { id: string; name: string; email: string; role: "admin" | "marketing" };

const Who = createContext<{ me: Me | null; refresh: () => void }>({ me: null, refresh: () => {} });
export const useMe = () => useContext(Who);

export function Gate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    api<{ user: Me | null; setup_needed: boolean }>("/api/auth")
      .then((r) => { setMe(r.user); setSetup(r.setup_needed); })
      .catch(() => { setMe(null); setSetup(false); })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!ready) return null;
  /* Nobody signed in means the door, every time. With no accounts yet it is the one-off setup
     form; otherwise it asks for a password.

     The first version of this let an unsigned visitor through whenever setup was already done —
     exactly backwards, and exactly the case that matters. The API refused every call behind it,
     so nothing leaked, but the app rendered as though it had opened. A gate whose failure looks
     like success is worse than no gate, because it is the one nobody re-checks. */
  if (!me) return <SignIn setup={setup} done={refresh} />;
  return <Who.Provider value={{ me, refresh }}>{children}</Who.Provider>;
}

function SignIn({ setup, done }: { setup: boolean; done: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await postJson("/api/auth", setup ? { action: "setup", name, email, password } : { email, password });
      done();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="gate">
      <form className="panel stack gate-card" onSubmit={submit}>
        <div>
          <h2 style={{ margin: 0 }}>{setup ? "Set up Circuit" : "Circuit"}</h2>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {setup
              ? "Make the first account. It is an admin, because an admin is who signs posts off."
              : "BNC Motors marketing"}
          </p>
        </div>

        {setup ? (
          <label className="field">
            <span className="eyebrow">Your name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        ) : null}

        <label className="field">
          <span className="eyebrow">Email</span>
          <input className="input" type="email" value={email} required autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label className="field">
          <span className="eyebrow">Password</span>
          <input className="input" type="password" value={password} required
            autoComplete={setup ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)} />
          {setup ? <span className="small muted">At least 10 characters.</span> : null}
        </label>

        {error ? <p className="note bad small" style={{ margin: 0 }}>{error}</p> : null}

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "…" : setup ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export function SignOutButton() {
  const { me, refresh } = useMe();
  if (!me) return null;
  return (
    <button className="btn small ghost" type="button"
      onClick={async () => { await postJson("/api/auth", { action: "out" }); refresh(); }}>
      Sign out
    </button>
  );
}
