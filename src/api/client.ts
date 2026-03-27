import type { ResolvedModel } from "../config/types";
import type { CommandType } from "../core/types";
import { type ApiEnvelope, endpoints, type TaskData } from "./types.ts";

async function httpJson(
  method: string,
  model: ResolvedModel,
  url: string,
  body?: unknown,
): Promise<unknown> {
  const fullUrl = `${model.apiBaseUrl}${url}`;
  console.error(`[DEBUG] HTTP ${method} ${fullUrl} (model=${model.id})`);

  const res = await fetch(fullUrl, {
    method,
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  console.error(`[DEBUG] HTTP ${method} ${fullUrl} -> ${res.status} ${res.statusText}`);

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    console.error(`[DEBUG] Failed to parse JSON response: ${text.substring(0, 200)}`);
    throw new Error(`Non JSON response with status ${res.status}`);
  }

  if (!res.ok) {
    const errorBody = json as Record<string, unknown> | undefined;
    const msg = errorBody?.error || errorBody?.message || res.statusText;
    console.error(`[DEBUG] HTTP error ${res.status}: ${msg}`);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  // Accept either envelope or direct
  if (json && typeof json === "object" && "data" in json) {
    return (json as ApiEnvelope).data;
  }
  return json as TaskData;
}

/**
 * Submit a generation task using a command-specific route derived from the
 * resolved model metadata.
 */
export async function submitTask(
  model: ResolvedModel,
  command: CommandType,
  payload: Record<string, unknown>,
): Promise<TaskData> {
  const target = buildSubmitTarget(model, command);
  return httpJson("POST", model, target.path, {
    ...payload,
    model: target.model,
  });
}

export async function getResult(model: ResolvedModel, requestId: string): Promise<TaskData> {
  return httpJson("GET", model, endpoints.result(requestId));
}

/**
 * Fetch the global Wavespeed model catalog used for cache refreshes and model
 * discovery.
 */
export async function getModels(apiKey: string): Promise<unknown[]> {
  // This endpoint is global, not tied to a specific model config
  // We use the default Wavespeed API base URL
  const url = `https://api.wavespeed.ai${endpoints.models}`;

  console.error(`[DEBUG] Fetching models from ${url}`);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    console.error(`[DEBUG] GET ${url} -> ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[DEBUG] Failed to fetch models: HTTP ${res.status}: ${text}`);
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();
    // The API returns { code: 200, data: [...] }
    if (json && Array.isArray(json.data)) {
      console.error(`[DEBUG] Successfully fetched ${json.data.length} models`);
      return json.data;
    }
    console.error(`[DEBUG] Unexpected response format, returning empty array`);
    return [];
  } catch (err) {
    console.error(`[DEBUG] Exception fetching models: ${(err as Error).message}`);
    throw new Error(`Failed to fetch models: ${(err as Error).message}`);
  }
}

/**
 * Build the canonical model route segment and submit path for a command.
 */
export function buildSubmitTarget(
  model: ResolvedModel,
  command: CommandType,
): { model: string; path: string } {
  const modelRef = model.modelName ?? model.id;

  const suffix =
    model.submitMode === "canonical"
      ? ""
      : {
          generate: "",
          edit: "/edit",
          "generate-sequential": "/sequential",
          "edit-sequential": "/edit-sequential",
        }[command];

  const canonicalModel = `${modelRef}${suffix}`;

  return {
    model: canonicalModel,
    path: `/api/v3/${canonicalModel}`,
  };
}

export { endpoints };
