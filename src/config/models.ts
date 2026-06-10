import { lookup } from "node:dns/promises";
import net from "node:net";
import { ModelCache } from "../cache";
import { inferApiModelType } from "../utils/model-routing.ts";
import { ConfigError } from "./load";
import { getRegistryModel } from "./registry";
import type { ResolvedModel, ResolvedModelSummary, WavespeedConfig } from "./types";

/**
 * Lightweight interface for API model cache data
 * Used to validate model IDs against the API without tight coupling
 */
export interface ApiModelCache {
  models: Array<{ model_id: string; type?: string }>;
}

const BUILTIN_MODEL_ID = "seedream-v4";
const WAVESPEED_HOST_SUFFIX = ".wavespeed.ai";
const CANONICAL_MODEL_SUFFIXES = [
  "/edit",
  "/sequential",
  "/edit-sequential",
  "/text-to-image",
  "/image-to-image",
  "/image-to-video",
  "/text-to-video",
  "/video-to-video",
  "/text-to-audio",
  "/audio-to-video",
];

const BUILTIN_MODEL_BASE: Omit<ResolvedModel, "apiKey"> = {
  id: BUILTIN_MODEL_ID,
  provider: "wavespeed",
  apiBaseUrl: "https://api.wavespeed.ai",
  apiKeyEnv: "WAVESPEED_API_KEY",
  modelName: "bytedance/seedream-v4",
  type: "image",
  requestDefaults: {},
  isFromConfig: false,
  submitMode: "base",
};

function envFlag(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[name] ?? "");
}

function normalizeHostnameForPolicy(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "");
}

function isKnownWavespeedHost(hostname: string): boolean {
  const normalized = normalizeHostnameForPolicy(hostname);
  return normalized === "wavespeed.ai" || normalized.endsWith(WAVESPEED_HOST_SUFFIX);
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

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostnameForPolicy(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const family = net.isIP(normalized);
  if (family === 4) return isPrivateIPv4(normalized);
  if (family === 6) return isPrivateIPv6(normalized);
  return false;
}

async function resolvedHostIsLocalOrPrivate(hostname: string): Promise<boolean> {
  const normalized = normalizeHostnameForPolicy(hostname);
  if (isLocalOrPrivateHost(normalized)) {
    return true;
  }

  const addresses = await lookup(normalized, { all: true, verbatim: true });
  return addresses.some((entry) => {
    const family = net.isIP(entry.address);
    if (family === 4) return isPrivateIPv4(entry.address);
    if (family === 6) return isPrivateIPv6(entry.address);
    return true;
  });
}

async function validateResolvedApiBaseUrlHost(modelId: string, apiBaseUrl: string): Promise<void> {
  if (envFlag("WAVESPEED_ALLOW_INSECURE_API_BASE_URL")) {
    return;
  }

  const parsed = new URL(apiBaseUrl);
  if (isKnownWavespeedHost(parsed.hostname)) {
    return;
  }

  let resolvesPrivate = false;
  try {
    resolvesPrivate = await resolvedHostIsLocalOrPrivate(parsed.hostname);
  } catch (err) {
    throw new ConfigError(
      `Model '${modelId}' apiBaseUrl host '${parsed.hostname}' could not be resolved for private-network validation: ${(err as Error).message}`,
      3,
    );
  }

  if (resolvesPrivate) {
    throw new ConfigError(
      `Model '${modelId}' apiBaseUrl must not resolve to localhost/private networks. Set WAVESPEED_ALLOW_INSECURE_API_BASE_URL=1 only for trusted local testing.`,
      3,
    );
  }
}

function validateApiBaseUrl(
  modelId: string,
  provider: ResolvedModel["provider"],
  apiBaseUrl: string,
  apiKeyEnv: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new ConfigError(`Model '${modelId}' has invalid apiBaseUrl '${apiBaseUrl}'.`, 3);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigError(`Model '${modelId}' apiBaseUrl must use http(s).`, 3);
  }

  const allowInsecure = envFlag("WAVESPEED_ALLOW_INSECURE_API_BASE_URL");
  if (parsed.protocol !== "https:" && !allowInsecure) {
    throw new ConfigError(
      `Model '${modelId}' apiBaseUrl must use HTTPS. Set WAVESPEED_ALLOW_INSECURE_API_BASE_URL=1 only for trusted local testing.`,
      3,
    );
  }

  if (isLocalOrPrivateHost(parsed.hostname) && !allowInsecure) {
    throw new ConfigError(
      `Model '${modelId}' apiBaseUrl must not point to localhost/private networks. Set WAVESPEED_ALLOW_INSECURE_API_BASE_URL=1 only for trusted local testing.`,
      3,
    );
  }

  if (parsed.username || parsed.password) {
    throw new ConfigError(`Model '${modelId}' apiBaseUrl must not include credentials.`, 3);
  }

  if (parsed.search || parsed.hash) {
    throw new ConfigError(`Model '${modelId}' apiBaseUrl must not include query or fragment.`, 3);
  }

  const isWavespeedHost = isKnownWavespeedHost(parsed.hostname);
  const allowCustom = envFlag("WAVESPEED_ALLOW_CUSTOM_API_BASE_URL");
  if (
    (envFlag("WAVESPEED_MCP_MODE") ||
      provider === "wavespeed" ||
      apiKeyEnv === "WAVESPEED_API_KEY") &&
    !isWavespeedHost &&
    !allowCustom
  ) {
    throw new ConfigError(
      `Model '${modelId}' would send ${apiKeyEnv} to non-Wavespeed host '${parsed.hostname}'. Set WAVESPEED_ALLOW_CUSTOM_API_BASE_URL=1 only for trusted custom gateways.`,
      3,
    );
  }

  return parsed.toString().replace(/\/+$/, "");
}

/**
 * Commands that submit model-backed generation tasks.
 */
export type ModelCommandName = "generate" | "edit" | "generate-sequential" | "edit-sequential";

/**
 * Minimal cache interface shared by CLI and MCP model resolution.
 */
export interface ApiModelCacheProvider {
  getCachedModels(): Promise<Array<{ model_id: string; type?: string }>>;
}

function toApiModelCache(
  models: Array<{ model_id: string; type?: string }>,
): ApiModelCache | undefined {
  return models.length > 0 ? { models } : undefined;
}

function stripCanonicalModelSuffix(modelRef?: string): string | undefined {
  if (!modelRef) {
    return undefined;
  }

  for (const suffix of CANONICAL_MODEL_SUFFIXES) {
    if (modelRef.endsWith(suffix)) {
      return modelRef.slice(0, -suffix.length);
    }
  }

  return modelRef;
}

function normalizeModelRefForType(
  modelRef: string | undefined,
  apiModelType?: string,
): string | undefined {
  return apiModelType === "ai-remover" ? stripCanonicalModelSuffix(modelRef) : modelRef;
}

function findCachedModelType(
  apiCache: ApiModelCache | undefined,
  ...refs: Array<string | undefined>
): string | undefined {
  for (const ref of refs) {
    const candidates = [ref, stripCanonicalModelSuffix(ref)].filter(
      (candidate, index, values): candidate is string =>
        Boolean(candidate) && values.indexOf(candidate) === index,
    );

    if (candidates.length === 0) {
      continue;
    }

    for (const candidate of candidates) {
      const match = apiCache?.models.find((model) => model.model_id === candidate);
      if (match?.type) {
        return match.type;
      }
    }
  }

  return undefined;
}

function resolveApiModelType(
  apiCache: ApiModelCache | undefined,
  id: string,
  modelName?: string,
  configuredType?: string,
): string | undefined {
  return (
    configuredType ??
    findCachedModelType(apiCache, modelName, id) ??
    inferApiModelType(modelName ?? id) ??
    inferApiModelType(stripCanonicalModelSuffix(modelName ?? id))
  );
}

/**
 * Resolve the requested model using cached API metadata when available, without
 * forcing a network fetch during normal CLI execution.
 */
export async function resolveModelForRequest(
  commandName: ModelCommandName,
  cliModelFlag: string | undefined,
  config: WavespeedConfig | undefined,
  apiModelCacheProvider: ApiModelCacheProvider = ModelCache.getInstance(),
): Promise<ResolvedModel> {
  let apiCache: ApiModelCache | undefined;

  try {
    const cachedModels = await apiModelCacheProvider.getCachedModels();
    apiCache = toApiModelCache(cachedModels);
  } catch {
    // Cache metadata is an optional optimization. Resolution must still succeed
    // through config, registry, or built-in defaults when cache reads fail.
  }

  const model = resolveModel(commandName, cliModelFlag, config, apiCache);
  await validateResolvedApiBaseUrlHost(model.id, model.apiBaseUrl);
  return model;
}

/**
 * Resolve the effective model for a command using explicit overrides, config
 * defaults, registry aliases, cached API models, and the built-in fallback.
 */
export function resolveModel(
  commandName: ModelCommandName,
  cliModelFlag: string | undefined,
  config: WavespeedConfig | undefined,
  apiCache?: ApiModelCache,
): ResolvedModel {
  // 1) CLI flag
  if (cliModelFlag) {
    return resolveModelId(
      cliModelFlag,
      config,
      apiCache,
      `Unknown model '${cliModelFlag}'. Use 'wavespeed models' to see available models.`,
    );
  }

  // 2) Command default
  const cmdDefaultId = config?.defaults?.commands?.[commandName];
  if (cmdDefaultId) {
    return resolveModelId(
      cmdDefaultId,
      config,
      apiCache,
      `Invalid config: defaults.commands.${commandName} refers to unknown model '${cmdDefaultId}'.`,
    );
  }

  // 3) Global default
  const globalDefaultId = config?.defaults?.globalModel;
  if (globalDefaultId) {
    return resolveModelId(
      globalDefaultId,
      config,
      apiCache,
      `Invalid config: defaults.globalModel '${globalDefaultId}' does not exist in models.`,
    );
  }

  // 4) Built-in fallback
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) {
    throw new ConfigError("Missing WAVESPEED_API_KEY for default Wavespeed model.", 2);
  }

  return {
    ...BUILTIN_MODEL_BASE,
    apiKey,
  };
}

/**
 * Resolve a model identifier through config aliases, built-in registry entries,
 * cached API metadata, or direct canonical model IDs.
 */
function resolveModelId(
  modelId: string,
  config: WavespeedConfig | undefined,
  apiCache: ApiModelCache | undefined,
  missingModelMessage: string,
): ResolvedModel {
  const modelConfig = config?.models?.[modelId];
  if (modelConfig) {
    const apiModelType = resolveApiModelType(
      apiCache,
      modelId,
      modelConfig.modelName,
      modelConfig.apiModelType,
    );
    const normalizedModelRef = normalizeModelRefForType(
      modelConfig.modelName ?? modelId,
      apiModelType,
    );

    return resolveFromConfigModel(
      modelId,
      {
        ...modelConfig,
        modelName: apiModelType === "ai-remover" ? normalizedModelRef : modelConfig.modelName,
      },
      inferSubmitMode(normalizedModelRef),
      apiModelType,
    );
  }

  const registryModel = getRegistryModel(modelId);
  if (registryModel) {
    const apiModelType = resolveApiModelType(apiCache, modelId, registryModel.modelName);
    const normalizedModelRef = normalizeModelRefForType(registryModel.modelName, apiModelType);

    return resolveFromConfigModel(
      modelId,
      {
        provider: registryModel.provider,
        apiBaseUrl: registryModel.apiBaseUrl,
        modelName: normalizedModelRef,
        apiKeyEnv: "WAVESPEED_API_KEY",
      },
      inferSubmitMode(normalizedModelRef),
      apiModelType,
    );
  }

  const cachedApiModel = apiCache?.models.find((model) => model.model_id === modelId);
  if (cachedApiModel) {
    const normalizedModelRef = normalizeModelRefForType(modelId, cachedApiModel.type);

    return resolveFromConfigModel(
      modelId,
      {
        provider: "wavespeed",
        modelName: normalizedModelRef,
      },
      inferSubmitMode(normalizedModelRef),
      cachedApiModel.type,
    );
  }

  if (modelId.includes("/")) {
    const apiModelType = resolveApiModelType(apiCache, modelId, modelId);
    const normalizedModelRef = normalizeModelRefForType(modelId, apiModelType);

    return resolveFromConfigModel(
      modelId,
      {
        provider: "wavespeed",
        modelName: normalizedModelRef,
      },
      inferSubmitMode(normalizedModelRef),
      apiModelType,
    );
  }

  throw new ConfigError(missingModelMessage, 3);
}

/**
 * Config aliases may already point at canonical API route segments such as
 * `google/nano-banana-2/edit`. Preserve those values so submit routing does not
 * append a second command suffix, even when the config omits `modelName` and
 * relies on the alias key itself.
 */
function inferSubmitMode(modelRef?: string): ResolvedModel["submitMode"] {
  if (!modelRef) {
    return "base";
  }

  return CANONICAL_MODEL_SUFFIXES.some((suffix) => modelRef.endsWith(suffix))
    ? "canonical"
    : "base";
}

/**
 * Normalize a configured or synthesized model reference into the runtime
 * structure used by the command and MCP layers.
 */
function resolveFromConfigModel(
  id: string,
  model: {
    provider: string;
    apiBaseUrl?: string;
    apiKeyEnv?: string;
    modelName?: string;
    apiModelType?: string;
    type?: "image" | "chat" | "completion";
    requestDefaults?: ResolvedModel["requestDefaults"];
  },
  submitMode: ResolvedModel["submitMode"] = inferSubmitMode(model.modelName ?? id),
  apiModelType: string | undefined = model.apiModelType,
): ResolvedModel {
  const provider = model.provider;

  // apiKeyEnv
  let apiKeyEnv = model.apiKeyEnv;
  if (!apiKeyEnv) {
    if (provider === "wavespeed") {
      apiKeyEnv = "WAVESPEED_API_KEY";
    } else {
      throw new ConfigError(`Model '${id}' is missing apiKeyEnv.`, 3);
    }
  }

  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new ConfigError(`Environment variable '${apiKeyEnv}' is not set for model '${id}'.`, 2);
  }

  // apiBaseUrl
  let apiBaseUrl = model.apiBaseUrl;
  if (!apiBaseUrl) {
    if (provider === "wavespeed") {
      apiBaseUrl = "https://api.wavespeed.ai";
    } else {
      throw new ConfigError(`Model '${id}' is missing apiBaseUrl.`, 3);
    }
  }

  apiBaseUrl = validateApiBaseUrl(id, provider as ResolvedModel["provider"], apiBaseUrl, apiKeyEnv);

  const type = model.type ?? "image";
  const requestDefaults = model.requestDefaults ?? {};

  return {
    id,
    provider: provider as ResolvedModel["provider"],
    apiBaseUrl,
    apiKey,
    apiKeyEnv,
    modelName: model.modelName,
    apiModelType,
    type,
    requestDefaults,
    isFromConfig: true,
    submitMode,
  };
}

/**
 * List configured model aliases together with default metadata for CLI display.
 */
export function listModels(
  config: WavespeedConfig | undefined,
  source?: string,
): { models: ResolvedModelSummary[]; source?: string } {
  if (!config) {
    const models: ResolvedModelSummary[] = [
      {
        id: BUILTIN_MODEL_ID,
        provider: "wavespeed",
        apiBaseUrl: "https://api.wavespeed.ai",
        modelName: "bytedance/seedream-v4",
        apiKeyEnv: "WAVESPEED_API_KEY",
        isDefaultGlobal: true,
        defaultForCommands: ["generate", "edit", "generate-sequential", "edit-sequential"],
      },
    ];
    return { models, source };
  }

  const summaries: ResolvedModelSummary[] = [];
  const defaults = config.defaults ?? {};
  const commandDefaults = defaults.commands ?? {};

  for (const [id, model] of Object.entries(config.models ?? {})) {
    const provider = model.provider;

    // Compute apiBaseUrl for listing: apply wavespeed default, do not throw.
    let apiBaseUrl = model.apiBaseUrl;
    if (!apiBaseUrl && provider === "wavespeed") {
      apiBaseUrl = "https://api.wavespeed.ai";
    }

    // Compute apiKeyEnv for listing: default for wavespeed, otherwise as-is (may be undefined).
    let apiKeyEnv = model.apiKeyEnv;
    if (!apiKeyEnv && provider === "wavespeed") {
      apiKeyEnv = "WAVESPEED_API_KEY";
    }

    const isDefaultGlobal = defaults.globalModel === id;
    const defaultForCommands: string[] = [];

    for (const [cmd, modelId] of Object.entries(commandDefaults)) {
      if (modelId === id) {
        defaultForCommands.push(cmd);
      }
    }

    summaries.push({
      id,
      provider,
      apiBaseUrl: apiBaseUrl ?? "",
      modelName: model.modelName,
      apiKeyEnv: apiKeyEnv ?? "",
      isDefaultGlobal,
      defaultForCommands,
    });
  }

  return { models: summaries, source };
}

export { ConfigError } from "./load";
