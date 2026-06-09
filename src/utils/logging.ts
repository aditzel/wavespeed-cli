const DEBUG_ENV_PATTERN = /^(1|true|yes|on)$/i;

export function isDebugEnabled(): boolean {
  return DEBUG_ENV_PATTERN.test(process.env.WAVESPEED_DEBUG ?? "");
}

export function debugLog(message: string): void {
  if (isDebugEnabled()) {
    console.error(message);
  }
}

export function truncateForLog(value: unknown, maxLength = 500): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) {
      url.username = "<redacted>";
    }
    if (url.password) {
      url.password = "<redacted>";
    }
    if (url.search) {
      url.search = "?redacted";
    }
    return url.toString();
  } catch {
    const queryIndex = value.indexOf("?");
    if (queryIndex === -1) {
      return value;
    }
    return `${value.slice(0, queryIndex)}?redacted`;
  }
}
