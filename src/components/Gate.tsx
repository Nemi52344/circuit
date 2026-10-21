"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { can, type Role, type Can } from "@/lib/roles";

/* The door. Nothing in Circuit renders until somebody is behind it.

   This is a client gate, so it is not the security — every API route checks the session for
   itself, and that is what actually protects the data. This exists so the app does not show a
   shell full of failed requests to someone who simply needs to sign in. */

export type Me = { id: string; name: string; email: string; role: Role };

/* The same grants the server enforces, so a button is not offered to somebody the API will
   refuse. This is politeness, not security: every route checks for itself. */
export const useCan = (what: Can): boolean => can(useContext(Who).me, what);

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
  /* "in" is the door; "asked" is after a code has been written and we are waiting for it. */
  const [mode, setMode] = useState<"in" | "asked">("in");
  const [code, setCode] = useState("");
  const [recovering, setRecovering] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (recovering && mode === "asked") {
        await postJson("/api/auth", { action: "recover-confirm", email, code, password });
      } else {
        await postJson("/api/auth", setup ? { action: "setup", name, email, password } : { email, password });
      }
      done();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const askForCode = async () => {
    if (!email.trim()) { setError("Type your email first, then ask for a code."); return; }
    setBusy(true); setError("");
    try {
      await postJson("/api/auth", { action: "recover", email });
      setRecovering(true); setMode("asked"); setPassword("");
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  if (recovering && mode === "asked") {
    return (
      <div className="gate">
        <form className="panel stack gate-card" onSubmit={submit}>
          <div>
            <h2 style={{ margin: 0 }}>Set a new password</h2>
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              A one-time code has been written to <code>data/recovery-code.txt</code> on the Mac
              running Circuit. It is printed in that window&rsquo;s terminal too. It lasts fifteen minutes.
            </p>
          </div>

          <label className="field">
            <span className="eyebrow">Email</span>
            <input className="input" type="email" value={email} required autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label className="field">
            <span className="eyebrow">Code from the file</span>
            <input className="input" value={code} required placeholder="XXXX-XXXX-XXXX"
              autoComplete="one-time-code" spellCheck={false}
              onChange={(e) => setCode(e.target.value)} />
          </label>

          <label className="field">
            <span className="eyebrow">New password</span>
            <input className="input" type="password" value={password} required autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)} />
            <span className="small muted">At least 10 characters. Your other sessions will end.</span>
          </label>

          {error ? <p className="note bad small" style={{ margin: 0 }}>{error}</p> : null}

          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "…" : "Set password and sign in"}
          </button>
          <button className="btn small ghost" type="button" disabled={busy}
            onClick={() => { setRecovering(false); setMode("in"); setCode(""); setPassword(""); setError(""); }}>
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="gate">
      <form className="panel stack gate-card" onSubmit={submit}>
        <div>
          <h2 style={{ margin: 0 }}>{setup ? "Set up Circuit" : "Circuit"}</h2>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {setup
              ? "Make the first account. It is the owner — the one role that can sign posts off and hand out the others."
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

        {/* Only once there are accounts: during setup there is nothing to recover. */}
        {setup ? null : (
          <button className="btn small ghost" type="button" disabled={busy} onClick={askForCode}>
            Forgotten your password?
          </button>
        )}
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
