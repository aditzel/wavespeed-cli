export function ensurePrompt(p: unknown): string {
  const s = String(p ?? "").trim();
  if (!s) throw new Error("Prompt is required");
  return s;
}

export function parseSize(input: unknown, defaultSize = "2048*2048"): string {
  const raw = String(input ?? defaultSize).trim();
  const cleaned = raw.replace(/x/gi, "*");
  const parts = cleaned.split("*").map((v) => parseInt(v, 10));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) {
    throw new Error('Size must be WIDTH*HEIGHT, for example 2048*2048');
  }
  const [w, h] = parts;
  if (w < 1024 || h < 1024 || w > 4096 || h > 4096) {
    throw new Error("Each size dimension must be between 1024 and 4096");
  }
  return `${w}*${h}`;
}

export function parseImagesList(arg: unknown, required: boolean, max = 10): string[] {
  const s = String(arg ?? "").trim();
  if (!s && required) throw new Error("Images are required");
  if (!s) return [];
  const items = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (items.length > max) {
    throw new Error(`At most ${max} images are allowed`);
  }
  const urls = items.map((u) => {
    try {
      return new URL(u).toString();
    } catch {
      throw new Error(`Invalid image URL: ${u}`);
    }
  });
  return urls;
}

export function parseMaxImages(input: unknown, defaultVal = 1): number {
  const n = Number(input ?? defaultVal);
  if (!Number.isInteger(n) || n < 1 || n > 15) {
    throw new Error("max-images must be an integer between 1 and 15");
  }
  return n;
}
