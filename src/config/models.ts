import { ModelCache } from "../cache";
import { ConfigError } from "./load";
import { getRegistryModel } from "./registry";
import type { ResolvedModel, ResolvedModelSummary, WavespeedConfig } from "./types";

/**
 * Lightweight interface for API model cache data
 * Used to validate model IDs against the API without tight coupling
 */
export interface ApiModelCache {
  models: Array<{ model_id: string }>;
}

const BUILTIN_MODEL_ID = "seedream-v4";
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

/**
 * Commands that submit model-backed generation tasks.
 */
export type ModelCommandName = "generate" | "edit" | "generate-sequential" | "edit-sequential";

/**
 * Minimal cache interface shared by CLI and MCP model resolution.
 */
export interface ApiModelCacheProvider {
  getCachedModels(): Promise<Array<{ model_id: string }>>;
}

function toApiModelCache(models: Array<{ model_id: string }>): ApiModelCache | undefined {
  return models.length > 0 ? { models } : undefined;
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

  return resolveModel(commandName, cliModelFlag, config, apiCache);
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
      `Unknown model '${cliModelFlag}'. Use --list-models to see available models.`,
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
    return resolveFromConfigModel(modelId, modelConfig);
  }

  const registryModel = getRegistryModel(modelId);
  if (registryModel) {
    return resolveFromConfigModel(
      modelId,
      {
        provider: registryModel.provider,
        apiBaseUrl: registryModel.apiBaseUrl,
        modelName: registryModel.modelName,
        apiKeyEnv: "WAVESPEED_API_KEY",
      },
      "base",
    );
  }

  const cachedApiModel = apiCache?.models.find((model) => model.model_id === modelId);
  if (cachedApiModel) {
    return resolveFromConfigModel(
      modelId,
      {
        provider: "wavespeed",
        modelName: modelId,
      },
      "canonical",
    );
  }

  if (modelId.includes("/")) {
    return resolveFromConfigModel(
      modelId,
      {
        provider: "wavespeed",
        modelName: modelId,
      },
      "canonical",
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
    type?: "image" | "chat" | "completion";
    requestDefaults?: ResolvedModel["requestDefaults"];
  },
  submitMode: ResolvedModel["submitMode"] = inferSubmitMode(model.modelName ?? id),
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

  const type = model.type ?? "image";
  const requestDefaults = model.requestDefaults ?? {};

  return {
    id,
    provider: provider as ResolvedModel["provider"],
    apiBaseUrl,
    apiKey,
    apiKeyEnv,
    modelName: model.modelName,
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
