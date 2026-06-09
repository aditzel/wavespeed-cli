import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { redactUrl } from "./logging.ts";

const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MiB
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

export interface LocalImageReadOptions {
  rootDir?: string;
  maxBytes?: number;
}

export interface DownloadImageOptions {
  maxBytes?: number;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  requireHttps?: boolean;
}

export interface SaveImagesOptions extends DownloadImageOptions {
  outputRoot?: string;
}

/**
 * Ensure the destination directory for saved outputs exists.
 */
export async function ensureOutputDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const info = await stat(dir);
  if (!info.isDirectory()) {
    throw new Error(`Output path is not a directory: ${dir}`);
  }
}

function isSubpath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function sanitizeFileComponent(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+$/, "")
    .slice(0, 120);
  return safe || "task";
}

function resolveOutputDir(outputDir: string, outputRoot?: string): string {
  if (!outputRoot) {
    return path.resolve(outputDir);
  }

  const root = path.resolve(outputRoot);
  const requested = path.isAbsolute(outputDir)
    ? path.resolve(outputDir)
    : path.resolve(root, outputDir);

  if (!isSubpath(requested, root)) {
    throw new Error(`Output directory must stay within configured output root: ${root}`);
  }

  return requested;
}

async function writeUniqueFile(destPath: string, data: Uint8Array | Buffer): Promise<string> {
  const parsed = path.parse(destPath);

  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate =
      attempt === 0 ? destPath : path.join(parsed.dir, `${parsed.name}-${attempt}${parsed.ext}`);

    try {
      const handle = await open(
        candidate,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        0o600,
      );
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
    }
  }

  throw new Error(`Unable to choose a unique output path for ${destPath}`);
}

export function detectImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((byte, index) => bytes[index] === byte)) {
      return "image/png";
    }
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (bytes.length >= 6) {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif";
    }
  }

  if (bytes.length >= 12) {
    const riff = Buffer.from(bytes.subarray(0, 4)).toString("ascii");
    const webp = Buffer.from(bytes.subarray(8, 12)).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return "image/webp";
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }

  return undefined;
}

function assertSupportedImage(bytes: Uint8Array, context: string): string {
  const mime = detectImageMime(bytes);
  if (!mime) {
    throw new Error(`${context} is not a supported image type`);
  }
  return mime;
}

function normalizeBase64(input: string): string {
  if (input.startsWith("data:")) {
    const idx = input.indexOf("base64,");
    return idx !== -1 ? input.slice(idx + "base64,".length) : input;
  }
  return input;
}

export function decodeBase64Image(input: string, maxBytes = DEFAULT_MAX_IMAGE_BYTES): Buffer {
  const normalized = normalizeBase64(input).trim();
  const buf = Buffer.from(normalized, "base64");

  if (!buf.length) {
    throw new Error("Image data is empty");
  }

  if (buf.length > maxBytes) {
    throw new Error(`Image exceeds maximum size of ${maxBytes} bytes`);
  }

  assertSupportedImage(buf, "Image data");
  return buf;
}

export function isDataUriImage(input: string): boolean {
  return /^data:image\/[A-Za-z0-9.+-]+;base64,/i.test(input.trim());
}

export function isBase64Image(input: string): boolean {
  try {
    decodeBase64Image(input, DEFAULT_MAX_IMAGE_BYTES);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a base64 or data-URI image string and write it to disk.
 */
export async function saveBase64Image(
  base64: string,
  destPath: string,
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
): Promise<string> {
  const buf = decodeBase64Image(base64, maxBytes);
  return writeUniqueFile(destPath, buf);
}

/**
 * Return true when the provided string is an HTTP(S) URL.
 */
export function isUrl(s: string): boolean {
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Check whether a local file path exists.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function extractIPv4FromMappedIPv6(address: string): string | undefined {
  const match = /^::ffff:(?:(?:0:){0,2})?(.+)$/i.exec(address);
  if (!match) return undefined;

  const embedded = match[1];
  if (net.isIP(embedded) === 4) {
    return embedded;
  }

  const hextets = embedded.split(":");
  if (hextets.length !== 2) {
    return undefined;
  }

  const high = Number.parseInt(hextets[0], 16);
  const low = Number.parseInt(hextets[1], 16);
  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return undefined;
  }

  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedIPv4 = extractIPv4FromMappedIPv6(normalized);
  if (mappedIPv4) {
    return isPrivateIPv4(mappedIPv4);
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8:")
  );
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    return isPrivateIPv4(address);
  }
  if (family === 6) {
    return isPrivateIPv6(address);
  }
  return false;
}

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

interface PinnedImageResponse {
  statusCode: number;
  statusMessage: string;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

async function resolvePublicHttpUrl(
  url: URL,
  { allowPrivateNetwork = false, requireHttps = false }: DownloadImageOptions,
): Promise<PinnedAddress[]> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol for image download: ${url.protocol}`);
  }

  if (requireHttps && url.protocol !== "https:") {
    throw new Error("Image download URL must use HTTPS");
  }

  const hostname = normalizedHostname(url);
  if (!allowPrivateNetwork && (hostname === "localhost" || hostname.endsWith(".localhost"))) {
    throw new Error("Refusing to download from localhost/private network URL");
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (!allowPrivateNetwork && isPrivateAddress(hostname)) {
      throw new Error("Refusing to download from localhost/private network URL");
    }
    return [{ address: hostname, family: literalFamily as 4 | 6 }];
  }

  const addresses = (await lookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));

  if (!addresses.length) {
    throw new Error(`Unable to resolve image download host: ${hostname}`);
  }

  if (!allowPrivateNetwork && addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Refusing to download from localhost/private network URL");
  }

  return addresses;
}

function getHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function requestPinnedUrl(
  url: URL,
  pinnedAddress: PinnedAddress,
  options: DownloadImageOptions,
): Promise<PinnedImageResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const hostname = normalizedHostname(url);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "image/*,*/*;q=0.8",
          Host: url.host,
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, pinnedAddress.address, pinnedAddress.family);
        },
        servername: url.protocol === "https:" && net.isIP(hostname) === 0 ? hostname : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        resolve({
          statusCode: res.statusCode ?? 0,
          statusMessage: res.statusMessage ?? "",
          headers: res.headers,
          body: res,
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Image download timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function requestImageWithRedirects(
  inputUrl: string,
  options: DownloadImageOptions,
  redirectCount = 0,
): Promise<PinnedImageResponse> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error("Image download exceeded redirect limit");
  }

  const url = new URL(inputUrl);
  const addresses = await resolvePublicHttpUrl(url, options);
  let lastError: unknown;

  for (const address of addresses) {
    try {
      const res = await requestPinnedUrl(url, address, options);

      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.body.resume();
        const location = getHeader(res.headers, "location");
        if (!location) {
          throw new Error(`Download redirect missing location for ${redactUrl(inputUrl)}`);
        }
        const nextUrl = new URL(location, url).toString();
        return requestImageWithRedirects(nextUrl, options, redirectCount + 1);
      }

      return res;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to download ${redactUrl(inputUrl)}`);
}

function readMessageWithLimit(
  res: IncomingMessage,
  headers: IncomingHttpHeaders,
  maxBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const contentLength = getHeader(headers, "content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      res.destroy();
      return Promise.reject(new Error(`Image exceeds maximum size of ${maxBytes} bytes`));
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        res.destroy(err);
        reject(err);
        return;
      }
      resolve(Buffer.concat(chunks, total));
    };

    const timer = setTimeout(() => {
      finish(new Error(`Image download timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    res.on("data", (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        finish(new Error(`Image exceeds maximum size of ${maxBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    res.on("end", () => finish());
    res.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
  });
}

/**
 * Download an image URL and write it to a local destination path.
 */
export async function downloadImageFromUrl(
  url: string,
  destPath: string,
  options: DownloadImageOptions = {},
): Promise<string> {
  const res = await requestImageWithRedirects(url, options);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    res.body.resume();
    throw new Error(`Download failed ${res.statusCode} ${res.statusMessage} for ${redactUrl(url)}`);
  }

  const contentType = getHeader(res.headers, "content-type");
  const normalizedContentType = contentType?.toLowerCase().split(";", 1)[0].trim();
  if (
    normalizedContentType &&
    !normalizedContentType.startsWith("image/") &&
    normalizedContentType !== "application/octet-stream"
  ) {
    throw new Error(`Download did not return an image content type for ${redactUrl(url)}`);
  }

  const bytes = await readMessageWithLimit(
    res.body,
    res.headers,
    options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
  );
  assertSupportedImage(bytes, "Downloaded output");
  return writeUniqueFile(destPath, bytes);
}

async function resolveValidatedLocalImagePath(
  filePath: string,
  options: LocalImageReadOptions = {},
): Promise<string> {
  const info = await lstat(filePath);
  if (!info.isFile()) {
    throw new Error(`Image path is not a regular file: ${filePath}`);
  }
  if (info.isSymbolicLink()) {
    throw new Error(`Image path must not be a symbolic link: ${filePath}`);
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (info.size > maxBytes) {
    throw new Error(`Image exceeds maximum size of ${maxBytes} bytes: ${filePath}`);
  }

  const resolvedPath = await realpath(filePath);
  if (options.rootDir) {
    const root = await realpath(options.rootDir);
    if (!isSubpath(resolvedPath, root)) {
      throw new Error(`Image file must stay within configured input root: ${root}`);
    }
  }

  return resolvedPath;
}

async function readValidatedLocalImage(
  filePath: string,
  options: LocalImageReadOptions = {},
): Promise<Buffer> {
  const resolvedPath = await resolveValidatedLocalImagePath(filePath, options);
  const noFollowFlag = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await open(resolvedPath, fsConstants.O_RDONLY | noFollowFlag);

  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new Error(`Image path is not a regular file: ${filePath}`);
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    if (info.size > maxBytes) {
      throw new Error(`Image exceeds maximum size of ${maxBytes} bytes: ${filePath}`);
    }

    const buffer = Buffer.from(await handle.readFile());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Image exceeds maximum size of ${maxBytes} bytes: ${filePath}`);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * Read a local file and encode it as base64 for API submission.
 */
export async function convertFileToBase64(
  filePath: string,
  options: LocalImageReadOptions = {},
): Promise<string> {
  const buffer = await readValidatedLocalImage(filePath, options);
  assertSupportedImage(buffer, `Image file '${filePath}'`);
  return buffer.toString("base64");
}

export async function convertFileToDataUri(
  filePath: string,
  options: LocalImageReadOptions = {},
): Promise<string> {
  const buffer = await readValidatedLocalImage(filePath, options);
  const mime = assertSupportedImage(buffer, `Image file '${filePath}'`);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Save every image output to disk, supporting both URL and base64 responses.
 */
export async function saveImagesFromOutputs(
  outputs: string[],
  outputDir: string,
  taskId: string,
  options: SaveImagesOptions = {},
): Promise<{
  savedPaths: string[];
  savedByIndex: Array<string | undefined>;
  failed: { index: number; reason: string }[];
}> {
  const resolvedOutputDir = resolveOutputDir(outputDir, options.outputRoot);
  await ensureOutputDir(resolvedOutputDir);
  if (options.outputRoot) {
    const rootRealPath = await realpath(path.resolve(options.outputRoot));
    const outputRealPath = await realpath(resolvedOutputDir);
    if (!isSubpath(outputRealPath, rootRealPath)) {
      throw new Error(`Output directory must stay within configured output root: ${rootRealPath}`);
    }
  }
  const safeTaskId = sanitizeFileComponent(taskId);

  const results = await Promise.allSettled(
    outputs.map((item, i) => {
      const filename = `${safeTaskId}_${i + 1}.png`;
      const destPath = path.join(resolvedOutputDir, filename);
      return (
        isUrl(item)
          ? downloadImageFromUrl(item, destPath, options)
          : saveBase64Image(item, destPath, options.maxBytes)
      ).then((savedPath) => savedPath);
    }),
  );
  const savedPaths: string[] = [];
  const savedByIndex: Array<string | undefined> = Array.from({ length: outputs.length });
  const failed: { index: number; reason: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      savedPaths.push(r.value);
      savedByIndex[i] = r.value;
    } else {
      failed.push({ index: i, reason: r.reason?.message ?? String(r.reason) });
    }
  });
  return { savedPaths, savedByIndex, failed };
}
