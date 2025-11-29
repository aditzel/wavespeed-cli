import { getResult } from "../api/client.ts";
import type { TaskData } from "../api/types.ts";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Model-agnostic polling helper. The API client is responsible for using the
// correct base URL and authentication for getResult.
export async function pollUntilDone(
  requestId: string,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  maxDurationMs: number = MAX_POLL_DURATION_MS,
): Promise<TaskData> {
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    if (now - start > maxDurationMs) {
      throw new Error(`Polling timed out after ${maxDurationMs}ms for request ${requestId}`);
    }

    const data = await getResult(requestId);

    if (data.status === "succeeded" || data.status === "failed") {
      return data;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
