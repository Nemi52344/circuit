import { redirect } from "next/navigation";

/* This page now lives inside a bigger one — the Content section was folded into Calendar,
   Content status, Studio and Library. Old links and bookmarks land in the right place. */
export default function Moved() {
  redirect("/content");
}
