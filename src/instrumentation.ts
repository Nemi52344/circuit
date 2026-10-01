/* Starts Circuit's automatic ChatGPT worker when the server boots. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
