import { BASE_URL, endpoints, TaskData, ApiEnvelope } from "./types.ts";

function getApiKey(): string {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) {
    console.error("Missing WAVESPEED_API_KEY environment variable.");
    console.error("In fish, ensure it is exported globally, for example:");
    console.error('set -Ux WAVESPEED_API_KEY "your_api_key"');
    process.exit(2);
  }
  return key;
}

async function httpJson(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non JSON response with status ${res.status}`);
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  // Accept either envelope or direct
  if (json && typeof json === "object" && "data" in json) {
    return (json as ApiEnvelope).data;
  }
  return json as TaskData;
}

export async function submitTask(path: string, payload: unknown): Promise<TaskData> {
  return httpJson("POST", path, payload);
}

export async function getResult(requestId: string): Promise<TaskData> {
  return httpJson("GET", endpoints.result(requestId));
}

export { endpoints };
