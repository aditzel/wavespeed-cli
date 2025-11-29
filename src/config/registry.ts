import type { ProviderType } from "./types";

export interface RegistryModel {
  id: string;
  name: string;
  provider: ProviderType;
  modelName: string;
  apiBaseUrl?: string;
  description?: string;
  docsUrl?: string;
  capabilities: ("image" | "edit" | "sequential")[];
  isRecommended?: boolean;
}

export const MODEL_REGISTRY: RegistryModel[] = [
  {
    id: "seedream-v4",
    name: "Bytedance Seedream V4",
    provider: "wavespeed",
    modelName: "bytedance/seedream-v4",
    description:
      "State-of-the-art text-to-image model optimized for multi-panel/tiled posters and design assets.",
    docsUrl: "https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v4",
    capabilities: ["image", "edit", "sequential"],
    isRecommended: true,
  },
  {
    id: "seedream-v3.1",
    name: "Bytedance Seedream V3.1",
    provider: "wavespeed",
    modelName: "bytedance/seedream-v3.1",
    description: "Previous generation high-quality image generation model.",
    docsUrl: "https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v3.1",
    capabilities: ["image"],
  },
];

export function getRegistryModel(id: string): RegistryModel | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function getAllRegistryModels(): RegistryModel[] {
  return [...MODEL_REGISTRY];
}
