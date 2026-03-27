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
  const cachedModels = await apiModelCacheProvider.getCachedModels();
  return resolveModel(commandName, cliModelFlag, config, toApiModelCache(cachedModels));
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
    const modelConfig = config?.models?.[cliModelFlag];
    // If not in config, check registry then API cache
    if (!modelConfig) {
      // Check registry for short aliases (e.g., "seedream-v4")
      const registryModel = getRegistryModel(cliModelFlag);
      if (registryModel) {
        // Construct a temporary model config from registry
        return resolveFromConfigModel(
          cliModelFlag,
          {
            provider: registryModel.provider,
            apiBaseUrl: registryModel.apiBaseUrl,
            modelName: registryModel.modelName,
            apiKeyEnv: "WAVESPEED_API_KEY", // Default to standard env
          },
          "base",
        );
      }

      // Check API cache for valid model IDs
      if (apiCache?.models) {
        const apiModel = apiCache.models.find((m) => m.model_id === cliModelFlag);
        if (apiModel) {
          // Model exists in API - construct wavespeed config
          return resolveFromConfigModel(
            cliModelFlag,
            {
              provider: "wavespeed",
              modelName: cliModelFlag,
            },
            "canonical",
          );
        }
      }

      // If model looks like an API model ID (contains '/'), trust it and let API validate
      // This handles cases where cache isn't loaded yet but user knows the model ID
      if (cliModelFlag.includes("/")) {
        return resolveFromConfigModel(
          cliModelFlag,
          {
            provider: "wavespeed",
            modelName: cliModelFlag,
          },
          "canonical",
        );
      }

      throw new ConfigError(
        `Unknown model '${cliModelFlag}'. Use --list-models to see available models.`,
        3,
      );
    }
    return resolveFromConfigModel(cliModelFlag, modelConfig);
  }

  // 2) Command default
  const cmdDefaultId = config?.defaults?.commands?.[commandName];
  if (cmdDefaultId) {
    const modelConfig = config?.models?.[cmdDefaultId];
    if (!modelConfig) {
      // Check registry if not in config
      const registryModel = getRegistryModel(cmdDefaultId);
      if (registryModel) {
        return resolveFromConfigModel(
          cmdDefaultId,
          {
            provider: registryModel.provider,
            apiBaseUrl: registryModel.apiBaseUrl,
            modelName: registryModel.modelName,
            apiKeyEnv: "WAVESPEED_API_KEY",
          },
          "base",
        );
      }

      // Check API cache for valid model IDs
      if (apiCache?.models) {
        const apiModel = apiCache.models.find((m) => m.model_id === cmdDefaultId);
        if (apiModel) {
          return resolveFromConfigModel(
            cmdDefaultId,
            {
              provider: "wavespeed",
              modelName: cmdDefaultId,
            },
            "canonical",
          );
        }
      }

      // Trust API model format
      if (cmdDefaultId.includes("/")) {
        return resolveFromConfigModel(
          cmdDefaultId,
          {
            provider: "wavespeed",
            modelName: cmdDefaultId,
          },
          "canonical",
        );
      }

      throw new ConfigError(
        `Invalid config: defaults.commands.${commandName} refers to unknown model '${cmdDefaultId}'.`,
        3,
      );
    }
    return resolveFromConfigModel(cmdDefaultId, modelConfig);
  }

  // 3) Global default
  const globalDefaultId = config?.defaults?.globalModel;
  if (globalDefaultId) {
    const modelConfig = config?.models?.[globalDefaultId];
    if (!modelConfig) {
      // Check registry if not in config
      const registryModel = getRegistryModel(globalDefaultId);
      if (registryModel) {
        return resolveFromConfigModel(
          globalDefaultId,
          {
            provider: registryModel.provider,
            apiBaseUrl: registryModel.apiBaseUrl,
            modelName: registryModel.modelName,
            apiKeyEnv: "WAVESPEED_API_KEY",
          },
          "base",
        );
      }

      // Check API cache for valid model IDs
      if (apiCache?.models) {
        const apiModel = apiCache.models.find((m) => m.model_id === globalDefaultId);
        if (apiModel) {
          return resolveFromConfigModel(
            globalDefaultId,
            {
              provider: "wavespeed",
              modelName: globalDefaultId,
            },
            "canonical",
          );
        }
      }

      // Trust API model format
      if (globalDefaultId.includes("/")) {
        return resolveFromConfigModel(
          globalDefaultId,
          {
            provider: "wavespeed",
            modelName: globalDefaultId,
          },
          "canonical",
        );
      }

      throw new ConfigError(
        `Invalid config: defaults.globalModel '${globalDefaultId}' does not exist in models.`,
        3,
      );
    }
    return resolveFromConfigModel(globalDefaultId, modelConfig);
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
 * Config aliases may already point at canonical API route segments such as
 * `google/nano-banana-2/edit`. Preserve those values so submit routing does not
 * append a second command suffix.
 */
function inferSubmitMode(modelName?: string): ResolvedModel["submitMode"] {
  if (!modelName) {
    return "base";
  }

  return CANONICAL_MODEL_SUFFIXES.some((suffix) => modelName.endsWith(suffix))
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
  submitMode: ResolvedModel["submitMode"] = inferSubmitMode(model.modelName),
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
