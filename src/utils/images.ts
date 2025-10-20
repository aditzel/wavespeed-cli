import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";

export async function ensureOutputDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function downloadImageFromUrl(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status} ${res.statusText} for ${url}`);
  }
  const ab = await res.arrayBuffer();
  await Bun.write(destPath, new Uint8Array(ab));
}

function normalizeBase64(input: string): string {
  if (input.startsWith("data:")) {
    const idx = input.indexOf("base64,");
    return idx !== -1 ? input.slice(idx + "base64,".length) : input;
  }
  return input;
}

export async function saveBase64Image(base64: string, destPath: string): Promise<void> {
  const normalized = normalizeBase64(base64);
  const buf = Buffer.from(normalized, "base64");
  await Bun.write(destPath, buf);
}

export function isUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function convertFileToBase64(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export async function saveImagesFromOutputs(
  outputs: string[],
  outputDir: string,
  taskId: string
): Promise<{ savedPaths: string[]; failed: { index: number; reason: string }[] }> {
  await ensureOutputDir(outputDir);
  const results = await Promise.allSettled(
    outputs.map((item, i) => {
      const filename = `${taskId}_${i + 1}.png`;
      const destPath = path.join(outputDir, filename);
      return (isUrl(item) ? downloadImageFromUrl(item, destPath) : saveBase64Image(item, destPath))
        .then(() => destPath);
    })
  );
  const savedPaths: string[] = [];
  const failed: { index: number; reason: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      savedPaths.push(r.value);
    } else {
      failed.push({ index: i, reason: r.reason?.message ?? String(r.reason) });
    }
  });
  return { savedPaths, failed };
}
