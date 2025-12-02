import { getResult } from "../api/client.ts";
import type { ResolvedModel } from "../config/types.ts";
import type { TaskData } from "../api/types.ts";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Polling helper that uses the model's API configuration for authenticated requests
export async function pollUntilDone(
  model: ResolvedModel,
  requestId: string,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  maxDurationMs: number = MAX_POLL_DURATION_MS,
): Promise<TaskData> {
  const start = Date.now();
  let iteration = 0;

  console.error(`[DEBUG] Starting polling for request ${requestId} (max ${maxDurationMs}ms)`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    iteration++;
    const now = Date.now();
    const elapsed = now - start;

    if (elapsed > maxDurationMs) {
      console.error(`[DEBUG] Polling timed out after ${elapsed}ms for request ${requestId}`);
      throw new Error(`Polling timed out after ${maxDurationMs}ms for request ${requestId}`);
    }

    console.error(`[DEBUG] Polling iteration ${iteration} for request ${requestId} (elapsed: ${elapsed}ms)`);

    const data = await getResult(model, requestId);

    if (data.status === "succeeded" || data.status === "failed") {
      console.error(`[DEBUG] Polling completed for request ${requestId}: status=${data.status} (${iteration} iterations, ${elapsed}ms)`);
      return data;
    }

    console.error(`[DEBUG] Request ${requestId} still processing (status: ${data.status}), waiting ${intervalMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
