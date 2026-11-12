"use client";
import { SectionTabs, useTab } from "@/components/SectionTabs";
import HealthView from "@/components/views/HealthView";
import WorkflowsView from "@/components/views/WorkflowsView";

/* Automation: is everything plugged in and running, and the routines themselves. Health first —
   it is the question somebody opens this with — then the drawn workflows. */
const TABS = [{ key: "health", label: "Health" }, { key: "workflows", label: "Workflows" }];

export default function AutomationPage() {
  const [tab, setTab] = useTab(TABS, "health");
  return (
    <div className="stack">
      <SectionTabs title="Automation" tabs={TABS} active={tab} onPick={setTab} />
      {tab === "workflows" ? <WorkflowsView /> : <HealthView />}
    </div>
  );
}
