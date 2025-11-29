import {
  ConfigLoadResult,
  ResolvedModel,
  ResolvedModelSummary,
  WavespeedConfig,
} from "./types";
import { ConfigError } from "./load";
import { getRegistryModel, getAllRegistryModels } from "./registry";

const BUILTIN_MODEL_ID = "seedream-v4";

const BUILTIN_MODEL_BASE: Omit<ResolvedModel, "apiKey"> = {
  id: BUILTIN_MODEL_ID,
  provider: "wavespeed",
  apiBaseUrl: "https://api.wavespeed.ai",
  apiKeyEnv: "WAVESPEED_API_KEY",
  modelName: "bytedance/seedream-v4",
  type: "image",
  requestDefaults: {},
  isFromConfig: false,
};

export function resolveModel(
  commandName: "generate" | "edit" | "generate-sequential" | "edit-sequential",
  cliModelFlag: string | undefined,
  config: WavespeedConfig | undefined
): ResolvedModel {
  // 1) CLI flag
  if (cliModelFlag) {
    const modelConfig = config?.models?.[cliModelFlag];
    // If not in config, check registry
    if (!modelConfig) {
      const registryModel = getRegistryModel(cliModelFlag);
      if (registryModel) {
        // Construct a temporary model config from registry
        return resolveFromConfigModel(cliModelFlag, {
            provider: registryModel.provider,
            apiBaseUrl: registryModel.apiBaseUrl,
            modelName: registryModel.modelName,
            apiKeyEnv: "WAVESPEED_API_KEY", // Default to standard env
        });
      }

      throw new ConfigError(
        `Unknown model '${cliModelFlag}'. Use --list-models to see available models.`,
        3
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
          return resolveFromConfigModel(cmdDefaultId, {
              provider: registryModel.provider,
              apiBaseUrl: registryModel.apiBaseUrl,
              modelName: registryModel.modelName,
              apiKeyEnv: "WAVESPEED_API_KEY",
          });
       }

      throw new ConfigError(
        `Invalid config: defaults.commands.${commandName} refers to unknown model '${cmdDefaultId}'.`,
        3
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
          return resolveFromConfigModel(globalDefaultId, {
              provider: registryModel.provider,
              apiBaseUrl: registryModel.apiBaseUrl,
              modelName: registryModel.modelName,
              apiKeyEnv: "WAVESPEED_API_KEY",
          });
       }
      throw new ConfigError(
        `Invalid config: defaults.globalModel '${globalDefaultId}' does not exist in models.`,
        3
      );
    }
    return resolveFromConfigModel(globalDefaultId, modelConfig);
  }

  // 4) Built-in fallback
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) {
    throw new ConfigError(
      "Missing WAVESPEED_API_KEY for default Wavespeed model.",
      2
    );
  }

  return {
    ...BUILTIN_MODEL_BASE,
    apiKey,
  };
}

function resolveFromConfigModel(
  id: string,
  model: {
    provider: string;
    apiBaseUrl?: string;
    apiKeyEnv?: string;
    modelName?: string;
    type?: "image" | "chat" | "completion";
    requestDefaults?: ResolvedModel["requestDefaults"];
  }
): ResolvedModel {
  const provider = model.provider;

  // apiKeyEnv
  let apiKeyEnv = model.apiKeyEnv;
  if (!apiKeyEnv) {
    if (provider === "wavespeed") {
      apiKeyEnv = "WAVESPEED_API_KEY";
    } else {
      throw new ConfigError(
        `Model '${id}' is missing apiKeyEnv.`,
        3
      );
    }
  }

  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new ConfigError(
      `Environment variable '${apiKeyEnv}' is not set for model '${id}'.`,
      2
    );
  }

  // apiBaseUrl
  let apiBaseUrl = model.apiBaseUrl;
  if (!apiBaseUrl) {
    if (provider === "wavespeed") {
      apiBaseUrl = "https://api.wavespeed.ai";
    } else {
      throw new ConfigError(
        `Model '${id}' is missing apiBaseUrl.`,
        3
      );
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
  };
}

export function listModels(
  config: WavespeedConfig | undefined,
  source?: string
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
        defaultForCommands: [
          "generate",
          "edit",
          "generate-sequential",
          "edit-sequential",
        ],
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