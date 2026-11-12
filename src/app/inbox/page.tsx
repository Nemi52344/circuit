import { redirect } from "next/navigation";

/* The Inbox became part of the Work page — pasting a message and work by email are both there
   now. Old links and bookmarks land where the work is. */
export default function InboxPage() {
  redirect("/work");
}
