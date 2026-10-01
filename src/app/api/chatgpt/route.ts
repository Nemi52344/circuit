import { handle, ok, bad, readJson } from "@/lib/http";
import { chatgptStatus, openChatGptLogin } from "@/lib/chatgpt";

export const runtime = "nodejs";

export const GET = handle(async () => ok(await chatgptStatus()));

/* Opens Codex's own ChatGPT sign-in in Terminal; Circuit never handles the credential. */
export const POST = handle(async (req) => {
  const b = await readJson<{ action?: string }>(req);
  if (b.action !== "login") return bad("Unknown action");
  try {
    await openChatGptLogin();
    return ok({ message: "Sign-in opened in Terminal. Finish it in your browser, then press Check again." });
  } catch (e) {
    return bad((e as Error).message);
  }
});
