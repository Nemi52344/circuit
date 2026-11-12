"use client";
import { SectionTabs, useTab } from "@/components/SectionTabs";
import CollateralView from "@/components/views/CollateralView";
import InspirationView from "@/components/views/InspirationView";
import EverythingView from "@/components/views/EverythingView";
import BrochuresView from "@/components/views/BrochuresView";

/* The Library: everything Circuit holds, in one place. Our own collateral from shoots first —
   the material every post is built from — then other brands' work kept for ideas, then
   everything including what Circuit made, then the brochures. */
const TABS = [
  { key: "collateral", label: "Our collateral" },
  { key: "inspiration", label: "Inspiration" },
  { key: "everything", label: "Everything" },
  { key: "brochures", label: "Brochures" },
];

export default function LibraryPage() {
  const [tab, setTab] = useTab(TABS, "collateral");
  return (
    <div className="stack">
      <SectionTabs title="Library" tabs={TABS} active={tab} onPick={setTab} />
      {tab === "inspiration" ? <InspirationView /> : tab === "everything" ? <EverythingView /> : tab === "brochures" ? <BrochuresView /> : <CollateralView />}
    </div>
  );
}
