export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return json as T;
}

export const postJson = <T = unknown>(url: string, body: unknown, method = "POST") =>
  api<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fileUrl = (id: string | null | undefined) => (id ? `/api/files/${id}` : "");

export const PLATFORMS = ["Instagram", "Facebook", "LinkedIn", "X", "YouTube", "WhatsApp", "Blog", "Email"] as const;

export function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function downloadUrl(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, name: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
