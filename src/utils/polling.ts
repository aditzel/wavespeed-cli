import { getResult } from "../api/client.ts";
import { TaskData } from "../api/types.ts";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  maxNetworkRetries?: number;
}

export async function pollUntilDone(id: string, opts: PollOptions = {}): Promise<TaskData> {
  const interval = opts.intervalMs ?? 2500;
  const timeout = opts.timeoutMs ?? 10 * 60 * 1000;
  const maxNetRetries = opts.maxNetworkRetries ?? 3;

  const start = Date.now();
  let netErrors = 0;

  for (;;) {
    if (Date.now() - start > timeout) {
      throw new Error("Polling timed out");
    }
    try {
      const data = await getResult(id);
      if (data.status === "completed" || data.status === "failed") {
        return data;
      }
      await sleep(interval);
      netErrors = 0;
    } catch (err) {
      netErrors += 1;
      if (netErrors > maxNetRetries) throw err;
      const backoff = interval * Math.min(4, netErrors);
      await sleep(backoff);
    }
  }
}
