import { convertFileToDataUri, decodeBase64Image, isDataUriImage, isUrl } from "./images.ts";

export interface ParseImagesListOptions {
  allowLocalFiles?: boolean;
  localFileRoot?: string;
  maxFileBytes?: number;
}

/**
 * Validate that a prompt-like input contains non-empty text.
 */
export function ensurePrompt(p: unknown): string {
  const s = String(p ?? "").trim();
  if (!s) throw new Error("Prompt is required");
  return s;
}

/**
 * Parse and validate a WIDTH*HEIGHT image size string.
 */
export function parseSize(input: unknown, defaultSize = "2048*2048"): string {
  let raw: string;
  if (input === null || input === undefined || input === "") {
    raw = defaultSize;
  } else {
    raw = String(input).trim();
  }

  const cleaned = raw.replace(/x/gi, "*");
  const parts = cleaned.split("*").map((v) => parseInt(v, 10));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) {
    throw new Error("Size must be WIDTH*HEIGHT, for example 2048*2048");
  }
  const [w, h] = parts;
  if (w < 1024 || h < 1024 || w > 4096 || h > 4096) {
    throw new Error("Each size dimension must be between 1024 and 4096");
  }
  return `${w}*${h}`;
}

function normalizeImageItems(arg: unknown): string[] {
  if (Array.isArray(arg)) {
    return arg.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  const s = String(arg ?? "").trim();
  if (!s) return [];

  if (s.includes("data:image/")) {
    const dataUriPattern = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi;
    const items: string[] = [];
    let lastIndex = 0;

    for (const match of s.matchAll(dataUriPattern)) {
      const index = match.index ?? 0;
      items.push(
        ...s
          .slice(lastIndex, index)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      );
      items.push(match[0]);
      lastIndex = index + match[0].length;
    }

    items.push(
      ...s
        .slice(lastIndex)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );

    if (items.some((item) => isDataUriImage(item))) {
      return items;
    }
  }

  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Parse and validate a comma-separated image list into URLs, data URIs, or
 * base64-encoded local image payloads.
 */
export async function parseImagesList(
  arg: unknown,
  required: boolean,
  max = 10,
  options: ParseImagesListOptions = {},
): Promise<string[]> {
  const items = normalizeImageItems(arg);
  if (!items.length && required) throw new Error("Images are required");
  if (!items.length) return [];
  if (items.length > max) {
    throw new Error(`At most ${max} images are allowed`);
  }

  const processedItems: string[] = [];

  for (const item of items) {
    if (isUrl(item)) {
      const url = new URL(item);
      processedItems.push(url.toString());
      continue;
    }

    if (isDataUriImage(item)) {
      decodeBase64Image(item, options.maxFileBytes);
      processedItems.push(item);
      continue;
    }

    try {
      decodeBase64Image(item, options.maxFileBytes);
      processedItems.push(item);
      continue;
    } catch {
      // Not raw image base64; fall through to optional local file handling.
    }

    if (options.allowLocalFiles === false) {
      throw new Error(
        "Local image file paths are disabled in this context. Use image URLs or data URI/base64 image data.",
      );
    }

    try {
      const dataUri = await convertFileToDataUri(item, {
        rootDir: options.localFileRoot,
        maxBytes: options.maxFileBytes,
      });
      processedItems.push(dataUri);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("ENOENT") || message.includes("no such file")) {
        throw new Error(`Image file not found: ${item}`);
      }
      throw err;
    }
  }

  return processedItems;
}

/**
 * Parse and validate the max-images argument for sequential operations.
 */
export function parseMaxImages(input: unknown, defaultVal = 1): number {
  const n = Number(input ?? defaultVal);
  if (!Number.isInteger(n) || n < 1 || n > 15) {
    throw new Error("max-images must be an integer between 1 and 15");
  }
  return n;
}
