export interface RequestDefaults {
  temperature?: number;
  maxTokens?: number;
  extraParams?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}

export type ProviderType = "wavespeed" | "openai" | "openai-compatible" | "custom";

export interface ModelConfig {
  id?: string;
  provider: ProviderType;
  apiBaseUrl?: string;
  apiKeyEnv?: string;
  modelName?: string;
  type?: "image" | "chat" | "completion";
  requestDefaults?: RequestDefaults;
}

export interface DefaultsConfig {
  globalModel?: string;
  commands?: {
    generate?: string;
    edit?: string;
    "generate-sequential"?: string;
    "edit-sequential"?: string;
  };
}

export interface WavespeedConfig {
  version?: string;
  models: Record<string, ModelConfig>;
  defaults?: DefaultsConfig;
  env?: Record<string, string>;
}

export interface ResolvedModel {
  id: string;
  provider: ProviderType;
  apiBaseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  modelName?: string;
  type: "image" | "chat" | "completion";
  requestDefaults: RequestDefaults;
  isFromConfig: boolean;
}

export interface ConfigLoadResult {
  config?: WavespeedConfig;
  path?: string;
}

export interface ResolvedModelSummary {
  id: string;
  provider: ProviderType;
  apiBaseUrl: string;
  modelName?: string;
  apiKeyEnv: string;
  isDefaultGlobal: boolean;
  defaultForCommands: string[];
}