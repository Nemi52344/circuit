"use client";
import { useMemo } from "react";
import { SectionTabs, useTab } from "@/components/SectionTabs";
import FinanceView from "@/components/views/FinanceView";
import BillsView from "@/components/views/BillsView";
import { useMe } from "@/components/Gate";
import { can } from "@/lib/roles";

/* Money: what marketing costs — AI subscriptions, people, other monthly costs — with the P&L
   for the whole of marketing beneath, and the bills and stock. Salaries and the P&L are the
   Admin's alone; bills, card statements and stock are run by the Manager too — so a Manager
   sees only that tab. */
export default function MoneyPage() {
  const { me } = useMe();
  const finance = can(me, "finance");
  const tabs = useMemo(() => [
    ...(finance ? [{ key: "finance", label: "Costs and P&L" }] : []),
    { key: "bills", label: "Bills and stock" },
  ], [finance]);
  const [tab, setTab] = useTab(tabs, tabs[0].key);
  return (
    <div className="stack">
      <SectionTabs title="Money" tabs={tabs} active={tab} onPick={setTab} />
      {tab === "finance" && finance ? <FinanceView /> : <BillsView />}
    </div>
  );
}
