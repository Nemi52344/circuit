"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { Kpi, Tabs, Cell, MoneyCell, Delta } from "@/components/Sheet";
import { money, moneyShort, monthLabel } from "@/lib/money";
import type { Person, Opex } from "@/lib/books";
import type { PnlMonth } from "@/lib/books";

/* Finance: what the month costs to run, and what it left behind.

   Salaries and standing costs are entered once with a start and an end. A month's figure is
   whatever was running that month — so nobody retypes the same salary twelve times, and a
   person who left in June stops appearing in July without anyone remembering to remove them.

   Revenue and cost of sales are the only numbers typed per month, because only they change
   per month in a way no list can work out. */

type Data = {
  people: Person[]; opex: Opex[]; pnl: PnlMonth[];
  summary: { month: PnlMonth; previous: PnlMonth; headcount: number; payroll: number; contract: number; opex_lines: number };
  categories: string[];
};

export default function FinancePage() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState("pnl");
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();

  const load = useCallback(() => api<Data>(`/api/finance?months=${months}`).then(setD).catch((e: Error) => push(e.message, "bad")), [push, months]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api("/api/finance", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };
  const addPerson = async () => { setBusy(true); try { await postJson("/api/finance", { what: "person", name: "New person" }); load(); } finally { setBusy(false); } };
  const addOpex = async () => { setBusy(true); try { await postJson("/api/finance", { what: "opex", item: "New cost" }); load(); } finally { setBusy(false); } };
  const drop = async (what: string, id: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    await api(`/api/finance?what=${what}&id=${id}`, { method: "DELETE" });
    load();
  };

  if (!d) return <p className="muted">Loading…</p>;
  const s = d.summary;
  const cur = s.month;
  const prev = s.previous;
  const rows = [...d.pnl].reverse();
  const peak = Math.max(1, ...d.pnl.map((p) => Math.abs(p.net)));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Finance</h2>
          <p className="lede">
            People and standing costs are entered once with a start and an end; each month adds up whatever was running then.
            Only revenue and cost of sales are typed month by month.
          </p>
        </div>
        <span className="actions">
          <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ minHeight: 38, width: "auto" }}>
            <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option>
          </select>
        </span>
      </div>

      <div className="grid-cards">
        <Kpi label={`Revenue · ${monthLabel(cur.month)}`} value={moneyShort(cur.revenue)} hint="Typed into the P&L below" />
        <Kpi label="Running cost" value={moneyShort(cur.costs)} hint={`${money(cur.manpower)} people · ${money(cur.opex)} opex`} />
        {/* An untouched month is not a good month — only a real surplus earns the accent. */}
        <Kpi label="Net" value={moneyShort(cur.net)} tone={cur.net > 0 ? "deep" : cur.net < 0 ? "graphite" : ""}
          hint={cur.margin === null ? "No revenue entered yet" : `${cur.margin}% of revenue`} />
        <Kpi label="Headcount" value={String(s.headcount)} hint={`${s.payroll} on payroll · ${s.contract} contract`} />
      </div>

      <Tabs
        tabs={[
          { key: "pnl", label: "P&L month on month", count: d.pnl.filter((p) => p.revenue || p.costs).length },
          { key: "people", label: "Manpower", count: d.people.length },
          { key: "opex", label: "Opex", count: d.opex.length },
        ]}
        active={tab} onPick={setTab}
      />

      {tab === "pnl" ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Month on month</h3>
            <span className="small muted">Latest first · <Delta now={cur.net} before={prev.net} /> on the month before</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Type revenue and cost of sales. Manpower and opex are added up from the lists, so they cannot fall out of step.
            Bills are shown beside the result and never inside it — a bill for rent and a rent line in opex are the same rupee.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Month</th>
                <th className="num">Revenue</th><th className="num">Cost of sales</th><th className="num">Gross</th>
                <th className="num">Manpower</th><th className="num">Opex</th><th className="num">Other in</th><th className="num">Other out</th>
                <th className="num">Net</th><th className="num">Margin</th><th className="num">Bills logged</th>
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.month}>
                    <td className="strong">{monthLabel(p.month)}</td>
                    <td className="num"><MoneyCell paise={p.revenue} onSave={(v) => patch({ what: "pnl", month: p.month, revenue: Math.round(Number(v || 0) * 100) })} /></td>
                    <td className="num"><MoneyCell paise={p.cogs} onSave={(v) => patch({ what: "pnl", month: p.month, cogs: Math.round(Number(v || 0) * 100) })} /></td>
                    <td className="num">{money(p.gross)}</td>
                    <td className="num muted">{money(p.manpower)}</td>
                    <td className="num muted">{money(p.opex)}</td>
                    <td className="num"><MoneyCell paise={p.other_in} onSave={(v) => patch({ what: "pnl", month: p.month, other_in: Math.round(Number(v || 0) * 100) })} /></td>
                    <td className="num"><MoneyCell paise={p.other_out} onSave={(v) => patch({ what: "pnl", month: p.month, other_out: Math.round(Number(v || 0) * 100) })} /></td>
                    <td className={`num strong ${p.net < 0 ? "bad-text" : ""}`}>{money(p.net)}</td>
                    <td className="num muted">{p.margin === null ? "—" : `${p.margin}%`}</td>
                    <td className="num muted">{p.bills ? money(p.bills) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Net, oldest to newest</div>
            <div className="mom">
              {d.pnl.map((p) => (
                <i key={p.month} className={p.net < 0 ? "neg" : ""}
                  style={{ height: `${Math.max(2, (Math.abs(p.net) / peak) * 100)}%` }}
                  title={`${monthLabel(p.month)} · ${money(p.net)}`} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "people" ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Manpower</h3>
            <span className="actions"><button className="btn small primary" type="button" disabled={busy} onClick={addPerson}>Add person</button></span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Monthly cost is the full cost to the company, not take-home. Leave the end date empty for anyone still here; fill it in and they drop out of later months by themselves.
          </p>
          {d.people.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Type</th><th className="num">Monthly cost</th><th>From</th><th>Until</th><th /></tr></thead>
                <tbody>
                  {d.people.map((p) => (
                    <tr key={p.id}>
                      <td style={{ minWidth: 140 }}><Cell value={p.name} onSave={(v) => patch({ what: "person", id: p.id, name: v })} /></td>
                      <td style={{ minWidth: 130 }}><Cell value={p.role} onSave={(v) => patch({ what: "person", id: p.id, role: v })} placeholder="—" /></td>
                      <td style={{ minWidth: 120 }}><Cell value={p.department} onSave={(v) => patch({ what: "person", id: p.id, department: v })} placeholder="—" /></td>
                      <td style={{ width: 120 }}><Cell value={p.kind} onSave={(v) => patch({ what: "person", id: p.id, kind: v })} options={["payroll", "contract", "intern"]} /></td>
                      <td className="num"><MoneyCell paise={p.monthly_cost} onSave={(v) => patch({ what: "person", id: p.id, monthly_cost: Math.round(Number(v || 0) * 100) })} /></td>
                      <td><Cell value={p.started_on} onSave={(v) => patch({ what: "person", id: p.id, started_on: v })} type="date" /></td>
                      <td><Cell value={p.ended_on} onSave={(v) => patch({ what: "person", id: p.id, ended_on: v })} type="date" /></td>
                      <td className="act"><button className="btn small ghost" type="button" onClick={() => drop("person", p.id, p.name)}>×</button></td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={4}>{d.people.length} {d.people.length === 1 ? "person" : "people"}</td>
                    <td className="num">{money(cur.manpower)}<span className="sub">running this month</span></td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <Empty title="Nobody on the list" hint="Add the team and every month's manpower figure fills itself in." />}
        </section>
      ) : null}

      {tab === "opex" ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Opex</h3>
            <span className="actions"><button className="btn small primary" type="button" disabled={busy} onClick={addOpex}>Add cost</button></span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Standing monthly costs — rent, software, insurance. One-off spend belongs in Admin as a bill.</p>
          {d.opex.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>What</th><th>Category</th><th>Vendor</th><th className="num">Per month</th><th>From</th><th>Until</th><th /></tr></thead>
                <tbody>
                  {d.opex.map((o) => (
                    <tr key={o.id}>
                      <td style={{ minWidth: 160 }}><Cell value={o.item} onSave={(v) => patch({ what: "opex", id: o.id, item: v })} /></td>
                      <td style={{ width: 150 }}><Cell value={o.category} onSave={(v) => patch({ what: "opex", id: o.id, category: v })} options={d.categories} /></td>
                      <td style={{ minWidth: 130 }}><Cell value={o.vendor} onSave={(v) => patch({ what: "opex", id: o.id, vendor: v })} placeholder="—" /></td>
                      <td className="num"><MoneyCell paise={o.monthly_cost} onSave={(v) => patch({ what: "opex", id: o.id, monthly_cost: Math.round(Number(v || 0) * 100) })} /></td>
                      <td><Cell value={o.starts_on} onSave={(v) => patch({ what: "opex", id: o.id, starts_on: v })} type="date" /></td>
                      <td><Cell value={o.ends_on} onSave={(v) => patch({ what: "opex", id: o.id, ends_on: v })} type="date" /></td>
                      <td className="act"><button className="btn small ghost" type="button" onClick={() => drop("opex", o.id, o.item)}>×</button></td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={3}>{d.opex.length} line{d.opex.length === 1 ? "" : "s"}</td>
                    <td className="num">{money(cur.opex)}<span className="sub">running this month</span></td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <Empty title="No standing costs yet" hint="Rent, software, insurance — anything that repeats every month." />}
        </section>
      ) : null}
    </div>
  );
}
