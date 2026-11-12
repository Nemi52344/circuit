"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/api";
import { Empty, useToast } from "@/components/ui";
import { Kpi, Cell, MoneyCell } from "@/components/Sheet";
import { money, moneyShort, monthLabel } from "@/lib/money";
import type { Person, Opex, Subscription, PnlMonth, MarketingMonth } from "@/lib/books";

/* What marketing costs, top to bottom, and what it came to.

   First the AI subscriptions — the biggest moving cost, and the one that creeps — held beside
   what the card actually charged. Then the people and their salaries. Then anything else that
   repeats every month. At the bottom the P&L for the whole of marketing, month by month, built
   from those lists and the bills, with the one number typed per month: the sales marketing
   brought in.

   Salaries and standing costs are entered once with a start and an end, so nobody retypes the
   same salary twelve times and a person who left in June stops appearing in July by itself. */

type Check = {
  month: string; read: boolean;
  rows: { id: string; tool: string; expected: number; charged: number; charges: number }[];
  unlisted: { vendor: string; amount: number; charges: number; month: string }[];
};
type Data = {
  people: Person[]; opex: Opex[]; pnl: PnlMonth[]; marketing: MarketingMonth[];
  subs: (Subscription & { ai: boolean })[]; sub_status: string[]; sub_cycles: string[]; sub_kinds: string[]; sub_check: Check;
  summary: { month: PnlMonth; previous: PnlMonth; headcount: number; payroll: number; contract: number; opex_lines: number };
  categories: string[];
};

const today = () => new Date().toISOString().slice(0, 10);
const rupees = (v: string) => Math.round(Number(v || 0) * 100);

export default function FinancePage() {
  const [d, setD] = useState<Data | null>(null);
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
  const add = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true);
    try { await postJson("/api/finance", body); if (done) push(done, "ok"); load(); }
    catch (e) { push((e as Error).message, "bad"); }
    finally { setBusy(false); }
  };
  const drop = async (what: string, id: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    await api(`/api/finance?what=${what}&id=${id}`, { method: "DELETE" });
    load();
  };

  if (!d) return <p className="muted">Loading…</p>;
  const cur = d.summary.month;
  const rows = [...d.pnl].reverse();
  const posts = new Map(d.marketing.map((m) => [m.month, m]));
  const live = d.subs.filter((x) => x.status === "active");
  const subMonthly = live.reduce((a, x) => a + x.monthly_cost, 0);
  const aiMonthly = live.filter((x) => x.ai).reduce((a, x) => a + x.monthly_cost, 0);
  const check = new Map(d.sub_check.rows.map((r) => [r.id, r]));
  const peak = Math.max(1, ...d.pnl.map((p) => p.costs));
  const sum = (k: keyof PnlMonth) => d.pnl.reduce((a, p) => a + (Number(p[k]) || 0), 0);
  const postedAll = d.pnl.reduce((a, p) => a + (posts.get(p.month)?.posted || 0), 0);

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Costs and P&amp;L</h2>
          <p className="lede">
            What marketing costs — the AI subscriptions, the people, everything else that repeats — and at the bottom the
            P&amp;L for the whole of marketing, month by month.
          </p>
        </div>
        <span className="actions">
          <select className="input" aria-label="How many months" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ minHeight: 38, width: "auto" }}>
            <option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option>
          </select>
        </span>
      </div>

      <div className="grid-cards">
        <Kpi label={`Marketing · ${monthLabel(cur.month)}`} value={moneyShort(cur.costs)} tone="deep"
          hint={`${moneyShort(cur.manpower)} people · ${moneyShort(cur.ai)} AI · ${moneyShort(cur.spend + cur.opex - cur.ai)} other`} />
        <Kpi label="Subscriptions" value={`${moneyShort(subMonthly)}/mo`} hint={`${live.length} active · ${moneyShort(aiMonthly)} of it AI · ${moneyShort(subMonthly * 12)} a year`} />
        <Kpi label="People" value={`${moneyShort(cur.manpower)}/mo`} hint={`${d.summary.headcount} on the team`} />
        <Kpi label="Cost per post" value={posts.get(cur.month)?.posted ? moneyShort(Math.round(cur.costs / (posts.get(cur.month)?.posted || 1))) : "—"}
          hint={posts.get(cur.month)?.posted ? `${posts.get(cur.month)?.posted} published this month` : "Nothing published this month yet"} />
      </div>

      {/* ---- 1 · Subscriptions ---- */}
      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3><span className="mn-step">1</span>Subscriptions</h3>
          <span className="actions"><button className="btn small primary" type="button" disabled={busy} onClick={() => add({ what: "sub", tool: "New tool" })}>Add subscription</button></span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Every tool we pay for — AI first. Cost is what one renewal costs in rupees; <b>per month</b> works itself out from how
          often it renews, so a three-year domain is a few rupees a month. In the P&amp;L each tool counts at what the card charged
          that month once the charge is in Bills, and at its cost here until then.
        </p>
        {d.subs.length ? (
          <div className="table-wrap">
            <table className="data mn-subs">
              <thead><tr>
                <th>Tool</th><th>Responsible</th><th>Type</th><th>Renews</th><th className="num">Price</th><th className="num">Cost (₹)</th><th className="num">Per month</th>
                <th>Card</th><th>Last paid</th><th>Status</th>
                <th className="num">{d.sub_check.read ? `On the card · ${monthLabel(d.sub_check.month)}` : "On the card"}</th><th />
              </tr></thead>
              <tbody>
                {d.subs.map((x) => {
                  const c = check.get(x.id);
                  const monthly = x.cycle === "monthly";
                  const off = c && c.charged && monthly && x.status === "active" && Math.abs(c.charged - x.period_cost) > Math.max(100_00, x.period_cost * 0.1);
                  return (
                    <tr key={x.id} className={x.status === "cancelled" ? "set-aside" : ""}>
                      <td>
                        <span className="mn-tool">
                          <Cell value={x.tool} onSave={(v) => patch({ what: "sub", id: x.id, tool: v })} />
                          {x.ai ? <span className="mn-src card">AI</span> : null}
                        </span>
                      </td>
                      <td><Cell value={x.owner} onSave={(v) => patch({ what: "sub", id: x.id, owner: v })} placeholder="Marketing" /></td>
                      <td><Cell value={x.kind} options={d.sub_kinds} onSave={(v) => patch({ what: "sub", id: x.id, kind: v })} /></td>
                      <td><Cell value={x.cycle} options={d.sub_cycles} onSave={(v) => patch({ what: "sub", id: x.id, cycle: v })} /></td>
                      <td className="num">
                        <span className="mn-price">
                          <Cell value={x.currency} options={["INR", "USD", "EUR", "GBP"]} onSave={(v) => patch({ what: "sub", id: x.id, currency: v })} />
                          {x.currency !== "INR" ? <Cell value={x.foreign_cost ? (x.foreign_cost / 100).toString() : ""} type="number" align="num" placeholder="0"
                            onSave={(v) => patch({ what: "sub", id: x.id, foreign_cost: rupees(v) })} /> : null}
                        </span>
                      </td>
                      <td className="num"><MoneyCell paise={x.period_cost} onSave={(v) => patch({ what: "sub", id: x.id, period_cost: rupees(v) })} /></td>
                      <td className="num strong">{x.monthly_cost ? money(x.monthly_cost) : "—"}</td>
                      <td><Cell value={x.card_holder} onSave={(v) => patch({ what: "sub", id: x.id, card_holder: v })} placeholder="whose card" /></td>
                      <td><Cell value={x.last_paid} type="date" onSave={(v) => patch({ what: "sub", id: x.id, last_paid: v, billing_day: Number(v.slice(8, 10)) || 0 })} /></td>
                      <td>
                        <Cell value={x.status} options={d.sub_status}
                          onSave={(v) => patch({ what: "sub", id: x.id, status: v, ...(v === "cancelled" && !x.ends_on ? { ends_on: today() } : {}) })} />
                      </td>
                      <td className="num">
                        {c && c.charged ? <span className={off ? "bad-text" : ""} title={off ? "Differs from the cost on the list" : undefined}>{money(c.charged)}</span>
                          : <span className="muted">{d.sub_check.read && x.status === "active" && monthly ? "no bill yet" : "—"}</span>}
                      </td>
                      <td className="act"><button className="btn small ghost" type="button" aria-label={`Remove ${x.tool}`} onClick={() => drop("sub", x.id, x.tool)}>×</button></td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td colSpan={6}>{live.length} active · AI {money(aiMonthly)} a month · other {money(subMonthly - aiMonthly)}</td>
                  <td className="num">{money(subMonthly)}<span className="sub">{moneyShort(subMonthly * 12)} a year</span></td>
                  <td colSpan={3} />
                  <td className="num">{d.sub_check.read ? money(d.sub_check.rows.reduce((a, r) => a + r.charged, 0)) : "—"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        ) : <Empty title="No subscriptions listed yet" hint="Add each tool you pay for — or add the ones the card already shows, below." />}
        {d.sub_check.unlisted.length ? (
          <div className="mn-unlisted">
            <span className="small"><b>Charged on the card in the last three months, not on the list</b> — add them so nothing is paid for unnoticed:</span>
            <div className="wk-chips">
              {d.sub_check.unlisted.map((u) => (
                <button key={u.vendor} type="button" className="chip" disabled={busy}
                  onClick={() => add({ what: "sub_from_card", vendor: u.vendor }, `${u.vendor} added at ${money(u.amount)} a month`)}>
                  + {u.vendor} · {money(u.amount)} in {monthLabel(u.month)}{u.charges > 1 ? ` (${u.charges} charges)` : ""}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* ---- 2 · People and salaries ---- */}
      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3><span className="mn-step">2</span>People and salaries</h3>
          <span className="actions"><button className="btn small primary" type="button" disabled={busy} onClick={() => add({ what: "person", name: "New person" })}>Add person</button></span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Monthly cost is the full cost to the company, not take-home. Leave the end date empty for anyone still here; fill it in and they drop out of later months by themselves.
        </p>
        {d.people.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Name</th><th>Role</th><th>Type</th><th className="num">Per month</th><th className="num">A year</th><th>From</th><th>Until</th><th /></tr></thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.id}>
                    <td style={{ minWidth: 140 }}><Cell value={p.name} onSave={(v) => patch({ what: "person", id: p.id, name: v })} /></td>
                    <td style={{ minWidth: 130 }}><Cell value={p.role} onSave={(v) => patch({ what: "person", id: p.id, role: v })} placeholder="—" /></td>
                    <td style={{ width: 120 }}><Cell value={p.kind} onSave={(v) => patch({ what: "person", id: p.id, kind: v })} options={["payroll", "contract", "intern"]} /></td>
                    <td className="num"><MoneyCell paise={p.monthly_cost} onSave={(v) => patch({ what: "person", id: p.id, monthly_cost: rupees(v) })} /></td>
                    <td className="num muted">{p.monthly_cost ? moneyShort(p.monthly_cost * 12) : "—"}</td>
                    <td><Cell value={p.started_on} onSave={(v) => patch({ what: "person", id: p.id, started_on: v })} type="date" /></td>
                    <td><Cell value={p.ended_on} onSave={(v) => patch({ what: "person", id: p.id, ended_on: v })} type="date" /></td>
                    <td className="act"><button className="btn small ghost" type="button" aria-label={`Remove ${p.name}`} onClick={() => drop("person", p.id, p.name)}>×</button></td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>{d.summary.headcount} on the team this month</td>
                  <td className="num">{money(cur.manpower)}<span className="sub">this month</span></td>
                  <td className="num muted">{moneyShort(cur.manpower * 12)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        ) : <Empty title="Nobody on the list" hint="Add the team and every month's people cost fills itself in." />}
      </section>

      {/* ---- 3 · Other standing costs ---- */}
      <details className="panel" open={d.opex.length > 0}>
        <summary>
          <strong><span className="mn-step">3</span>Other monthly costs</strong>
          <span className="muted small"> — {d.opex.length ? `${d.opex.length} line${d.opex.length === 1 ? "" : "s"} · ${money(cur.opex - cur.ai)} this month` : "rent, a retainer, insurance — anything that repeats at the same amount"}</span>
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <p className="small muted" style={{ margin: 0 }}>Only costs that repeat at the same amount. Anything billed — ads, a domain, printing — is already in the P&amp;L from Bills, so do not add it here too.</p>
            <button className="btn small primary" type="button" disabled={busy} onClick={() => add({ what: "opex", item: "New cost" })}>Add cost</button>
          </div>
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
                      <td className="num"><MoneyCell paise={o.monthly_cost} onSave={(v) => patch({ what: "opex", id: o.id, monthly_cost: rupees(v) })} /></td>
                      <td><Cell value={o.starts_on} onSave={(v) => patch({ what: "opex", id: o.id, starts_on: v })} type="date" /></td>
                      <td><Cell value={o.ends_on} onSave={(v) => patch({ what: "opex", id: o.id, ends_on: v })} type="date" /></td>
                      <td className="act"><button className="btn small ghost" type="button" aria-label={`Remove ${o.item}`} onClick={() => drop("opex", o.id, o.item)}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </details>

      {/* ---- 4 · The P&L for the whole of marketing ---- */}
      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h3><span className="mn-step">4</span>Marketing P&amp;L</h3>
          <span className="small muted">Latest first · the last {d.pnl.length} months</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Costs build themselves from the lists above and from Bills. Each tool counts at its card charge when that is in Bills,
          at its listed cost when not — the tag says which: <b>card</b>, <b>list</b> or <b>mixed</b>. The one thing to type is <b>Sales from marketing</b> —
          what marketing brought in that month, from the leads it generated.
        </p>
        <div className="table-wrap">
          <table className="data mn-pnl">
            <thead><tr>
              <th>Month</th>
              <th className="num">People</th><th className="num">AI tools</th><th className="num">Ads and other bills</th><th className="num">Other monthly</th>
              <th className="num">Total cost</th><th className="num">Sales from marketing</th><th className="num">Net</th>
              <th className="num">Posts out</th><th className="num">Cost per post</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const m = posts.get(p.month);
                return (
                  <tr key={p.month}>
                    <td className="strong">{monthLabel(p.month)}</td>
                    <td className="num">{p.manpower ? money(p.manpower) : "—"}</td>
                    <td className="num">{p.ai ? <>{money(p.ai)} <span className={`mn-src ${p.ai_source}`}>{p.ai_source}</span></> : "—"}</td>
                    <td className="num">{p.spend ? money(p.spend) : "—"}</td>
                    <td className="num muted">{p.opex - p.ai ? money(p.opex - p.ai) : "—"}</td>
                    <td className="num strong">{p.costs ? money(p.costs) : "—"}</td>
                    <td className="num"><MoneyCell paise={p.revenue} onSave={(v) => patch({ what: "pnl", month: p.month, revenue: rupees(v) })} /></td>
                    <td className={`num strong ${p.net < 0 ? "bad-text" : ""}`}>{p.costs || p.revenue ? money(p.net) : "—"}</td>
                    <td className="num muted">{m?.posted || "—"}</td>
                    <td className="num muted">{m?.posted ? money(Math.round(p.costs / m.posted)) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td>{d.pnl.length} months</td>
                <td className="num">{money(sum("manpower"))}</td>
                <td className="num">{money(sum("ai"))}</td>
                <td className="num">{money(sum("spend"))}</td>
                <td className="num">{money(sum("opex") - sum("ai"))}</td>
                <td className="num">{money(sum("costs"))}</td>
                <td className="num">{money(sum("revenue"))}</td>
                <td className={`num ${sum("net") < 0 ? "bad-text" : ""}`}>{money(sum("net"))}</td>
                <td className="num">{postedAll || "—"}</td>
                <td className="num">{postedAll ? money(Math.round(sum("costs") / postedAll)) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>What marketing cost each month, oldest to newest</div>
          <div className="mn-stack" role="img" aria-label="Monthly marketing cost split into people, AI tools and other">
            {d.pnl.map((p) => (
              <div key={p.month} className="mn-col" title={`${monthLabel(p.month)} · ${money(p.costs)} — people ${money(p.manpower)}, AI ${money(p.ai)}, other ${money(p.costs - p.manpower - p.ai)}`}>
                <div className="mn-bar" style={{ height: `${Math.max(1, (p.costs / peak) * 100)}%` }}>
                  <i className="o" style={{ flex: Math.max(0, p.costs - p.manpower - p.ai) }} />
                  <i className="a" style={{ flex: p.ai }} />
                  <i className="p" style={{ flex: p.manpower }} />
                </div>
                <span>{monthLabel(p.month).slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="mn-legend small"><span><i className="p" />People</span><span><i className="a" />AI tools</span><span><i className="o" />Ads, bills and other</span></div>
        </div>
        {sum("revenue") === 0 ? <p className="small muted" style={{ margin: 0 }}>Type sales from marketing in a month to see marketing&rsquo;s net. Until then, net is only the cost.</p> : null}
      </section>
    </div>
  );
}
