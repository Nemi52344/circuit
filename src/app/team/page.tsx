import { redirect } from "next/navigation";

/* The team lives on the Work page now, where work is given out: Work → Team. */
export default async function Moved({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(tab === "logins" ? "/work?panel=logins" : "/work?panel=team");
}
