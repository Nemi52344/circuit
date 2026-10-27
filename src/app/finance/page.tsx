"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { Kpi, Tabs, Cell, MoneyCell, Delta } from "@/components/Sheet";
import { money, moneyShort, monthLabel } from "@/lib/money";
import type { Person, Opex, MarketingMonth, AiMonth } from "@/lib/books";
import type { PnlMonth } from "@/lib/books";

/* Finance: what the month costs to run, and what it left behind.

   Salaries and standing costs are entered once with a start and an end. A month's figure is
   whatever was running that month — so nobody retypes the same salary twelve times, and a
   person who left in June stops appearing in July without anyone remembering to remove them.

   Revenue and cost of sales are the only numbers typed per month, because only they change
   per month in a way no list can work out. */

type Data = {
  people: Person[]; opex: Opex[]; pnl: PnlMonth[]; marketing: MarketingMonth[]; ai: AiMonth[];
  summary: { month: PnlMonth; previous: PnlMonth; headcount: number; payroll: number; contract: number; opex_lines: number };
  categories: string[];
};

export default function FinancePage() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState("cost");
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
  const mk = d.marketing[d.marketing.length - 1];
  const spend = [...d.marketing].reverse();
  const topSpend = Math.max(1, ...d.marketing.map((m) => m.total));
  const peak = Math.max(1, ...d.pnl.map((p) => Math.abs(p.net)));

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Finance</h2>
          <p className="lede">
            Marketing does not sell anything, so it has no revenue of its own. What it has is two salaries and a pile of
            AI subscriptions — so the month is those two numbers, and what they bought.
          </p>
        </div>
        <span className="actions">
          <select className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ minHeight: 38, width: "auto" }}>
            <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option>
          </select>
        </span>
      </div>

      <div className="grid-cards">
        <Kpi label={`Marketing · ${monthLabel(mk.month)}`} value={moneyShort(mk.total)} tone="deep"
          hint={`${money(mk.people)} people · ${money(mk.tools)} tools`} />
        <Kpi label="People" value={moneyShort(mk.people)} hint={`${mk.heads} on the team`} />
        <Kpi label="AI tools" value={moneyShort(mk.tools)}
          hint={mk.tool_lines ? `${mk.tool_lines} charge${mk.tool_lines === 1 ? "" : "s"} this month` : "No statement loaded yet"} />
        {/* Cost per post only means something once something has gone out. Until then the honest
            thing to show is the backlog, not a number divided by nothing. */}
        <Kpi label="Cost per post" value={mk.per_post === null ? "—" : moneyShort(mk.per_post)}
          hint={mk.per_post === null ? `Nothing published yet · ${mk.planned} waiting` : `${mk.posted} published`} />
      </div>

      <Tabs
        tabs={[
          { key: "cost", label: "What marketing costs", count: d.marketing.filter((m) => m.total).length },
          { key: "pnl", label: "P&L month on month", count: d.pnl.filter((p) => p.revenue || p.costs).length },
          { key: "people", label: "Manpower", count: d.people.length },
          { key: "opex", label: "Opex", count: d.opex.length + (d.ai[0]?.tools.length || 0) },
        ]}
        active={tab} onPick={setTab}
      />

      {tab === "cost" ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>What marketing costs</h3>
            <span className="small muted">Latest first</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Salaries come from the Manpower list; tools are the card charges read off the monthly statement, so a month
            with no statement loaded shows no tools rather than a guess. Cost per post divides by what actually went out —
            planned work costs the same as finished work and proves nothing.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>
                <th>Month</th>
                <th className="num">People</th><th className="num">AI tools</th><th className="num">Total</th>
                <th className="num">Published</th><th className="num">Waiting</th><th className="num">Cost per post</th>
              </tr></thead>
              <tbody>
                {spend.map((m) => (
                  <tr key={m.month}>
                    <td className="strong">{monthLabel(m.month)}</td>
                    <td className="num muted">{m.people ? money(m.people) : "—"}</td>
                    <td className="num muted">{m.tools ? money(m.tools) : "—"}</td>
                    <td className="num strong">{m.total ? money(m.total) : "—"}</td>
                    <td className="num">{m.posted || "—"}</td>
                    <td className="num muted">{m.planned - m.posted || "—"}</td>
                    <td className="num">{m.per_post === null ? <span className="muted">—</span> : money(m.per_post)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Monthly spend, oldest to newest</div>
            <div className="mom">
              {d.marketing.map((m) => (
                <i key={m.month} style={{ height: `${Math.max(2, (m.total / topSpend) * 100)}%` }}
                  title={`${monthLabel(m.month)} · ${money(m.total)}`} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === "pnl" ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Month on month</h3>
            <span className="small muted">Latest first · <Delta now={cur.net} before={prev.net} /> on the month before</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Type revenue and cost of sales. Manpower comes from the team list and opex from the standing costs plus every AI bill,
            so none of it is typed twice. Other bills are shown beside the result and never inside it — a bill for rent and a rent line in opex are the same rupee.
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
        <>
        {/* The AI bill, counted from the bills themselves — nobody types it. */}
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>AI and automation tools</h3>
            <span className="muted small">Filled in every month from the bills — Claude, ChatGPT, Grok, Higgsfield, Zapier and the rest</span>
          </div>
          {d.ai.some((m) => m.total) ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Month</th><th>Tools</th><th className="num">AI cost</th></tr></thead>
                <tbody>
                  {d.ai.filter((m, i) => m.total || i === 0).map((m) => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month)}</td>
                      <td className="small">{m.tools.length ? m.tools.map((t) => `${t.vendor} ${money(t.amount)}`).join(" · ") : <span className="muted">No AI bills dated this month yet — they arrive when the card statement is read</span>}</td>
                      <td className="num">{money(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No AI bills yet" hint="Add them in Admin, or read a card statement — they land here on their own." />}
          <p className="small muted" style={{ margin: 0 }}>A bill counts here if its category is &ldquo;ai&rdquo; or its vendor is a known AI or automation tool. Do not also add these below as standing costs — they would be counted twice.</p>
        </section>
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Other standing costs</h3>
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
                    <td className="num">{money(cur.opex - (cur.ai || 0))}<span className="sub">running this month</span></td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <Empty title="No other standing costs" hint="Rent, insurance — anything else that repeats every month." />}
        </section>
        </>
      ) : null}
    </div>
  );
}
