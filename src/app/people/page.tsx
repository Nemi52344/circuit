"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { useToast, Empty } from "@/components/ui";
import { useMe } from "@/components/Gate";
import { ROLES, asRole, can, type Role } from "@/lib/roles";

/* Who can use Circuit, and what each of them may do.

   Five roles. The one that matters is approver: somebody who can sign work off and cannot make
   any of it. Separating those two is the only thing that makes a sign-off mean anything —
   otherwise the person who wrote the post is also the person who decided it was ready, which
   is one person twice rather than two people. */

type User = { id: string; name: string; email: string; role: Role; active: number; created_at: string };

export default function PeoplePage() {
  const { me } = useMe();
  const [users, setUsers] = useState<User[]>([]);
  const [add, setAdd] = useState({ name: "", email: "", role: "creator" as Role, password: "" });
  const [reset, setReset] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();

  const load = useCallback(() => api<{ users: User[] }>("/api/users").then((r) => setUsers(r.users)).catch(() => null), []);
  const labelOf = (r: string) => ROLES.find((x) => x.role === asRole(r)) || ROLES[ROLES.length - 1];
  useEffect(() => { load(); }, [load]);

  const admin = can(me, "people");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await postJson("/api/users", add);
      setAdd({ name: "", email: "", role: "creator", password: "" });
      push("Added. Tell them their password in person, not over email.", "ok");
      load();
    } catch (err) { push((err as Error).message, "bad"); } finally { setBusy(false); }
  };

  const patch = async (body: Record<string, unknown>, said: string) => {
    try { await api("/api/users", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }); push(said, "ok"); load(); }
    catch (e) { push((e as Error).message, "bad"); }
  };

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>People</h2>
          <p className="lede">
            Nothing goes public without somebody who can sign it off, because publishing cannot be undone —
            Instagram has no delete at all. An approver signs work off and cannot make any of it, which is the
            point: otherwise the person who wrote the post is also the person who decided it was ready.
          </p>
        </div>
      </div>

      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}><h3>On the system</h3><span className="small muted">{users.length}</span></div>
        {users.length === 0 ? <Empty title="Nobody yet" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{admin ? <th>Change</th> : null}</tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="strong">{u.name}{u.id === me?.id ? <span className="small muted"> · you</span> : null}</td>
                    <td className="muted">{u.email}</td>
                    <td>
                      <strong>{labelOf(u.role).label}</strong>
                      <div className="small muted">{labelOf(u.role).what}</div>
                    </td>
                    <td className={u.active ? "" : "muted"}>{u.active ? "Active" : "Switched off"}</td>
                    {admin ? (
                      <td>
                        <span className="actions">
                          <select className="input small" aria-label={`Role for ${u.name}`} value={asRole(u.role)}
                            onChange={(e) => patch({ id: u.id, role: e.target.value }, "Role changed")}>
                            {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                          </select>
                          <button className="btn small ghost" type="button"
                            onClick={() => patch({ id: u.id, active: !u.active }, u.active ? "Switched off" : "Switched on")}>
                            {u.active ? "Switch off" : "Switch on"}
                          </button>
                        </span>
                        <span className="actions" style={{ marginTop: 6 }}>
                          <input className="input" type="password" placeholder="New password" aria-label="New password for this person"
                            value={reset[u.id] || ""} onChange={(e) => setReset((r) => ({ ...r, [u.id]: e.target.value }))} />
                          <button className="btn small" type="button" disabled={!reset[u.id]}
                            onClick={() => { patch({ id: u.id, password: reset[u.id] }, "Password changed — their other sessions have ended"); setReset((r) => ({ ...r, [u.id]: "" })); }}>
                            Set
                          </button>
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {admin ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Add someone</h3>
          <form className="form-grid" onSubmit={create}>
            <label className="field">
              <span className="eyebrow">Name</span>
              <input className="input" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="eyebrow">Email</span>
              <input className="input" type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} />
            </label>
            <label className="field">
              <span className="eyebrow">Role</span>
              <select className="select" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r.role} value={r.role}>{r.label} — {r.what.toLowerCase()}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="eyebrow">First password</span>
              <input className="input" type="password" required value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} />
              <span className="small muted">At least 10 characters. They can change it later.</span>
            </label>
            <span className="actions">
              <button className="btn primary" type="submit" disabled={busy}>Add</button>
            </span>
          </form>
        </section>
      ) : null}
    </div>
  );
}
