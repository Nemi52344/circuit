import { redirect } from "next/navigation";

/* This page now lives inside a bigger one — the Run section was folded into Money, Team,
   Automation and Settings. Old links and bookmarks land in the right place. */
export default function Moved() {
  redirect("/work?panel=logins");
}
