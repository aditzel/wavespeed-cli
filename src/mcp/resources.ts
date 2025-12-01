import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config/load";
import { listModels } from "../config/models";
import { getAllRegistryModels } from "../config/registry";

/**
 * Compact model representation for MCP resources
 * Token-efficient: abbreviated capability names
 */
interface CompactModel {
  id: string;
  name: string;
  provider: string;
  caps: string[]; // Abbreviated: "gen" | "edit" | "seq"
  recommended?: boolean;
  default?: boolean;
}

/**
 * Convert capability names to abbreviated form
 */
function abbreviateCaps(capabilities: string[]): string[] {
  const abbrevMap: Record<string, string> = {
    image: "gen",
    edit: "edit",
    sequential: "seq",
  };
  return capabilities.map((c) => abbrevMap[c] || c);
}

/**
 * Register all MCP resources
 */
export function registerResources(server: McpServer): void {
  // Static resource: Available models from registry
  server.registerResource(
    "models-available",
    "models://available",
    {
      title: "Available Models",
      description: "All available models from Wavespeed registry",
      mimeType: "application/json",
    },
    async (uri) => {
      const registryModels = getAllRegistryModels();

      const compactModels: CompactModel[] = registryModels.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        caps: abbreviateCaps(m.capabilities),
        ...(m.isRecommended && { recommended: true }),
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ models: compactModels }, null, 2),
          },
        ],
      };
    },
  );

  // Static resource: Configured models from user config
  server.registerResource(
    "models-configured",
    "models://configured",
    {
      title: "Configured Models",
      description: "Models configured in your local config file",
      mimeType: "application/json",
    },
    async (uri) => {
      const { config, path } = loadConfig();
      const { models: configuredModels, source } = listModels(config, path);

      const compactModels: CompactModel[] = configuredModels.map((m) => ({
        id: m.id,
        name: m.modelName || m.id,
        provider: m.provider,
        caps: ["gen", "edit", "seq"], // Assume all caps for configured models
        ...(m.isDefaultGlobal && { default: true }),
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                models: compactModels,
                ...(source && { configPath: source }),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Static resource: Combined view
  server.registerResource(
    "models-all",
    "models://all",
    {
      title: "All Models",
      description: "Combined view of registry and configured models",
      mimeType: "application/json",
    },
    async (uri) => {
      const registryModels = getAllRegistryModels();
      const { config, path } = loadConfig();
      const { models: configuredModels } = listModels(config, path);

      const registry: CompactModel[] = registryModels.map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        caps: abbreviateCaps(m.capabilities),
        ...(m.isRecommended && { recommended: true }),
      }));

      const configured: CompactModel[] = configuredModels.map((m) => ({
        id: m.id,
        name: m.modelName || m.id,
        provider: m.provider,
        caps: ["gen", "edit", "seq"],
        ...(m.isDefaultGlobal && { default: true }),
      }));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                registry,
                configured,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
