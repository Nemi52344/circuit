"use client";
import { useCallback, useEffect, useState } from "react";
import { api, postJson, fileUrl } from "@/lib/api";
import { Pill, Empty, useToast } from "@/components/ui";
import { Kpi, Tabs, Cell, MoneyCell } from "@/components/Sheet";
import { money, moneyShort } from "@/lib/money";
import type { Bill, StockItem } from "@/lib/books";
import type { Statement, Charge } from "@/lib/statement";

/* Admin: what we owe and what we hold.

   Two plain registers. Everything is typed in, because there is no system to read it from, and
   a number nobody typed is a number nobody can stand behind. */

type Data = {
  bills: Bill[]; stock: StockItem[];
  summary: { bills: number; unpaid: number; unpaid_value: number; overdue: number; this_month: number; items: number; stock_value: number; low: number; never_counted: number };
  statuses: string[]; categories: string[];
};

const today = () => new Date().toISOString().slice(0, 10);

export default function AdminPage() {
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState("bills");
  const [st, setSt] = useState<{ statements: Statement[]; waiting: (Charge & { statement: string })[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [busy, setBusy] = useState(false);
  const { push, view } = useToast();

  const load = useCallback(() => {
    api<Data>("/api/admin").then(setD).catch((e: Error) => push(e.message, "bad"));
    api<{ statements: Statement[]; waiting: (Charge & { statement: string })[] }>("/api/statements").then(setSt).catch(() => null);
  }, [push]);
  useEffect(() => { load(); }, [load]);

  /* The statement leads: it is the only record carrying what the card was actually charged,
     conversion fee and all. The receipts come afterwards and hang off it. */
  const upload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("name", f.name.replace(/\.pdf$/i, ""));
    setBusy(true);
    try {
      const r = await api<{ statement: Statement; charges: Charge[] }>("/api/statements", { method: "POST", body: fd });
      push(`${r.charges.length} charge${r.charges.length === 1 ? "" : "s"} read off ${r.statement.name}`, "ok");
      setOpen(r.statement.id);
      setCharges(r.charges);
      load();
    } catch (e) { push((e as Error).message, "bad"); }
    finally { setBusy(false); ev.target.value = ""; }
  };

  const openStatement = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    const r = await api<{ charges: Charge[] }>(`/api/statements?id=${id}`);
    setCharges(r.charges);
    setOpen(id);
  };

  const patch = async (body: Record<string, unknown>) => {
    try {
      await api("/api/admin", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
      load();
    } catch (e) { push((e as Error).message, "bad"); }
  };

  const addBill = async () => {
    setBusy(true);
    try { await postJson("/api/admin", { what: "bill", vendor: "New vendor", bill_date: today() }); load(); }
    catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  const addStock = async () => {
    setBusy(true);
    try { await postJson("/api/admin", { what: "stock", item: "New item" }); load(); }
    catch (e) { push((e as Error).message, "bad"); } finally { setBusy(false); }
  };

  const drop = async (what: string, id: string, name: string) => {
    if (!confirm(`Remove "${name}"?`)) return;
    await api(`/api/admin?what=${what}&id=${id}`, { method: "DELETE" });
    load();
  };

  /* A bill's own paperwork, kept with it. */
  const attach = async (bill: Bill, ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("files", f);
    fd.append("kind", "bill");
    try {
      const saved = await api<{ id: string }[]>("/api/files", { method: "POST", body: fd });
      await patch({ what: "bill", id: bill.id, file_id: saved[0].id });
      push("Attached", "ok");
    } catch (e) { push((e as Error).message, "bad"); } finally { ev.target.value = ""; }
  };

  if (!d) return <p className="muted">Loading…</p>;
  const s = d.summary;

  return (
    <div className="stack">
      {view}
      <div className="page-head">
        <div>
          <h2>Admin</h2>
          <p className="lede">What we owe and what we hold. Type into any box and it saves when you leave it.</p>
        </div>
        <span className="actions">
          <button className="btn" type="button" disabled={busy} onClick={addStock}>Add stock item</button>
          <button className="btn primary" type="button" disabled={busy} onClick={addBill}>Add bill</button>
        </span>
      </div>

      <div className="grid-cards">
        <Kpi label="Bills unpaid" value={money(s.unpaid_value)} hint={`${s.unpaid} of ${s.bills} bill${s.bills === 1 ? "" : "s"}`} tone={s.unpaid ? "graphite" : ""} />
        <Kpi label="Overdue" value={String(s.overdue)} hint={s.overdue ? "Past the due date" : "Nothing past its date"} tone={s.overdue ? "graphite" : ""} />
        <Kpi label="Billed this month" value={money(s.this_month)} />
        <Kpi label="Stock on hand" value={moneyShort(s.stock_value)} hint={`${s.items} item${s.items === 1 ? "" : "s"}${s.low ? `, ${s.low} at reorder` : ""}`} tone={s.low ? "graphite" : ""} />
      </div>

      <Tabs tabs={[
        { key: "bills", label: "Bills", count: d.bills.length },
        { key: "cards", label: "Card statements", count: st?.statements.length || 0 },
        { key: "stock", label: "Stock", count: d.stock.length },
      ]} active={tab} onPick={setTab} />

      {tab === "cards" ? (
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3>Card statements</h3>
            <span className="actions">
              {st?.waiting.length ? <Pill tone="warn">{st.waiting.length} without a receipt</Pill> : null}
              <label className="btn small primary">
                {busy ? "Reading…" : "Upload a statement"}
                <input type="file" accept="application/pdf" hidden onChange={upload} disabled={busy} />
              </label>
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            The statement is the honest number: it carries the card&apos;s conversion fee, which a tool&apos;s own
            receipt never shows. Upload it and every charge is read off it; the matching receipts are then
            found in the inbox and attached.
          </p>
          {st?.statements.length ? (
            <div className="list">
              {st.statements.map((x) => (
                <div key={x.id} className="list-item" style={{ gridTemplateColumns: "1fr auto", cursor: "pointer" }} onClick={() => openStatement(x.id)}>
                  <div>
                    <strong>{x.name}</strong>
                    <p>{[x.period, x.card ? `card ${x.card}` : "", `${x.lines} charges`, x.total ? money(x.total) : ""].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className="btn small ghost">{open === x.id ? "Hide" : "What was on it"}</span>
                </div>
              ))}
            </div>
          ) : <Empty title="No statement yet" hint="Upload the month's credit card statement and Circuit reads every charge off it." />}

          {open && charges.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Date</th><th>Merchant</th><th className="num">Charged</th><th>In foreign</th><th>Receipt</th></tr></thead>
                <tbody>
                  {charges.map((c) => (
                    <tr key={c.id}>
                      <td>{c.charged_on || "—"}</td>
                      <td className="strong">{c.merchant}</td>
                      <td className="num strong">{money(c.amount)}</td>
                      <td className="muted">{c.foreign_amount || "—"}</td>
                      <td>{c.status === "matched" ? <Pill tone="ok">attached</Pill> : <Pill>looking</Pill>}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={2}>{charges.length} charges</td>
                    <td className="num">{money(charges.reduce((a, c) => a + c.amount, 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "bills" ? (
        <section className="panel stack">
          <p className="small muted" style={{ margin: 0 }}>
            Amount and tax are kept apart so the total is always the two added up. Attach the PDF or photo and it stays with the bill.
          </p>
          {d.bills.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th>Vendor</th><th>Number</th><th>Date</th><th>Due</th>
                  <th className="num">Amount</th><th className="num">Tax</th><th className="num">Total</th>
                  <th>Category</th><th>Status</th><th>File</th><th />
                </tr></thead>
                <tbody>
                  {d.bills.map((b) => {
                    const overdue = b.status === "unpaid" && b.due_date && b.due_date < today();
                    return (
                      <tr key={b.id}>
                        <td style={{ minWidth: 150 }}><Cell value={b.vendor} onSave={(v) => patch({ what: "bill", id: b.id, vendor: v })} /></td>
                        <td style={{ minWidth: 110 }}><Cell value={b.number} onSave={(v) => patch({ what: "bill", id: b.id, number: v })} placeholder="—" /></td>
                        <td><Cell value={b.bill_date} onSave={(v) => patch({ what: "bill", id: b.id, bill_date: v })} type="date" /></td>
                        <td>
                          <Cell value={b.due_date} onSave={(v) => patch({ what: "bill", id: b.id, due_date: v })} type="date" />
                          {overdue ? <span className="sub bad-text">overdue</span> : null}
                        </td>
                        <td className="num"><MoneyCell paise={b.amount} onSave={(v) => patch({ what: "bill", id: b.id, amount: Math.round(Number(v || 0) * 100) })} /></td>
                        <td className="num"><MoneyCell paise={b.tax} onSave={(v) => patch({ what: "bill", id: b.id, tax: Math.round(Number(v || 0) * 100) })} /></td>
                        <td className="num strong">{money(b.amount + b.tax)}</td>
                        <td><Cell value={b.category} onSave={(v) => patch({ what: "bill", id: b.id, category: v })} options={d.categories} /></td>
                        <td><Cell value={b.status} onSave={(v) => patch({ what: "bill", id: b.id, status: v })} options={d.statuses} /></td>
                        <td>
                          {b.file_id
                            ? <a className="btn small ghost" href={fileUrl(b.file_id)} target="_blank" rel="noreferrer">Open</a>
                            : <label className="btn small ghost">Attach<input type="file" hidden onChange={(e) => attach(b, e)} /></label>}
                        </td>
                        <td className="act"><button className="btn small ghost" type="button" onClick={() => drop("bill", b.id, b.vendor)}>×</button></td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td colSpan={4}>{d.bills.length} bill{d.bills.length === 1 ? "" : "s"}</td>
                    <td className="num">{money(d.bills.reduce((a, b) => a + b.amount, 0))}</td>
                    <td className="num">{money(d.bills.reduce((a, b) => a + b.tax, 0))}</td>
                    <td className="num">{money(d.bills.reduce((a, b) => a + b.amount + b.tax, 0))}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <Empty title="No bills yet" hint="Add one and fill the row in." />}
        </section>
      ) : (
        <section className="panel stack">
          <p className="small muted" style={{ margin: 0 }}>
            Changing a quantity counts as a count, so the date looks after itself. Set a reorder level and anything at or below it is flagged.
          </p>
          {d.stock.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th>Item</th><th>SKU</th><th>Where</th>
                  <th className="num">Qty</th><th>Unit</th><th className="num">Reorder at</th>
                  <th className="num">Unit cost</th><th className="num">Value</th><th>Counted</th><th />
                </tr></thead>
                <tbody>
                  {d.stock.map((it) => {
                    const low = it.reorder_at > 0 && it.qty <= it.reorder_at;
                    return (
                      <tr key={it.id}>
                        <td style={{ minWidth: 160 }}>
                          <Cell value={it.item} onSave={(v) => patch({ what: "stock", id: it.id, item: v })} />
                          {low ? <span className="sub bad-text">at or below reorder level</span> : null}
                        </td>
                        <td style={{ minWidth: 100 }}><Cell value={it.sku} onSave={(v) => patch({ what: "stock", id: it.id, sku: v })} placeholder="—" /></td>
                        <td style={{ minWidth: 110 }}><Cell value={it.location} onSave={(v) => patch({ what: "stock", id: it.id, location: v })} placeholder="—" /></td>
                        <td className="num"><Cell value={it.qty} onSave={(v) => patch({ what: "stock", id: it.id, qty: Number(v) || 0 })} type="number" align="num" /></td>
                        <td style={{ width: 90 }}><Cell value={it.unit} onSave={(v) => patch({ what: "stock", id: it.id, unit: v })} /></td>
                        <td className="num"><Cell value={it.reorder_at} onSave={(v) => patch({ what: "stock", id: it.id, reorder_at: Number(v) || 0 })} type="number" align="num" /></td>
                        <td className="num"><MoneyCell paise={it.unit_cost} onSave={(v) => patch({ what: "stock", id: it.id, unit_cost: Math.round(Number(v || 0) * 100) })} /></td>
                        <td className="num strong">{money(Math.round(it.qty * it.unit_cost))}</td>
                        <td className="small muted">{it.counted_at || "never"}</td>
                        <td className="act"><button className="btn small ghost" type="button" onClick={() => drop("stock", it.id, it.item)}>×</button></td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td colSpan={7}>{d.stock.length} item{d.stock.length === 1 ? "" : "s"}{s.low ? ` · ${s.low} at reorder` : ""}</td>
                    <td className="num">{money(s.stock_value)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <Empty title="Nothing counted yet" hint="Add an item, put the quantity in, and the value works itself out." />}
        </section>
      )}
    </div>
  );
}
