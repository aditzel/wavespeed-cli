import { Command } from "commander";
import { loadConfig } from "../config/load";
import { listModels } from "../config/models";
import { getAllRegistryModels } from "../config/registry";
import { getModels } from "../api/client";
import { ModelSchema } from "../api/types";

export function registerModels(program: Command) {
  program
    .command("models")
    .description("List available models (configured + registry + API)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const { config, path } = loadConfig();
      
      // 1. Local Config Models
      const { models: configuredModels, source } = listModels(config, path);

      // 2. Local Registry Models
      const registryModels = getAllRegistryModels();
      
      // 3. Fetch Live Models from API
      let apiModels: ModelSchema[] = [];
      let apiError: string | undefined;
      
      // Try to find a valid API key
      const apiKey = process.env.WAVESPEED_API_KEY || 
                     config?.models?.[config?.defaults?.globalModel ?? ""]?.apiKeyEnv && process.env[config!.models![config!.defaults!.globalModel!]!.apiKeyEnv!];

      if (apiKey) {
        try {
            if (!opts.json) {
                process.stdout.write("Fetching models from API... ");
            }
            apiModels = await getModels(apiKey);
            if (!opts.json) {
                process.stdout.write("Done.\n");
            }
        } catch (err: any) {
            apiError = err.message;
            if (!opts.json) {
                process.stdout.write("Failed.\n");
            }
        }
      } else {
        apiError = "No API key found (WAVESPEED_API_KEY not set)";
      }

      if (opts.json) {
        const payload = {
          source: source ?? null,
          configured: configuredModels,
          registry: registryModels,
          api: apiModels,
          apiError
        };
        console.log(JSON.stringify(payload, null, 2));
      } else {
        if (source) {
          console.log(`Config source: ${source}`);
        } else {
          console.log("Using built-in default Wavespeed model configuration.");
        }
        
        console.log("\n--- Configured Models (Local Aliases) ---");
        if (configuredModels.length === 0) console.log("  (None configured)");
        for (const m of configuredModels) {
          const flags: string[] = [];
          if (m.isDefaultGlobal) flags.push("*");
          if (m.defaultForCommands.length) flags.push(`[cmd=${m.defaultForCommands.join(",")}]`);
          const flagStr = flags.length ? ` ${flags.join(" ")}` : "";
          console.log(
            `  ${m.id}${flagStr} provider=${m.provider} baseUrl=${m.apiBaseUrl} modelName=${m.modelName ?? ""} keyEnv=${m.apiKeyEnv}`
          );
        }

        console.log("\n--- Available Models (API & Registry) ---");
        
        // Merge API and Registry models for display
        const displayMap = new Map<string, { name: string, desc: string, source: string[], type: string }>();
        
        // Add registry models
        for (const rm of registryModels) {
            displayMap.set(rm.modelName, { // Key by modelName (e.g. "bytedance/seedream-v4")
                name: rm.name,
                desc: rm.description || "",
                source: ["Registry"],
                type: rm.capabilities.join(", ")
            });
        }
        
        // Merge API models
        for (const am of apiModels) {
            const existing = displayMap.get(am.model_id);
            if (existing) {
                existing.source.push("API");
                // Update description if API has one and registry doesn't (or just overwrite)
                if (am.description) existing.desc = am.description;
            } else {
                displayMap.set(am.model_id, {
                    name: am.name || am.model_id,
                    desc: am.description || "",
                    source: ["API"],
                    type: am.type
                });
            }
        }

        if (displayMap.size === 0) {
             console.log("  (No models found)");
        }

        // Display sorted list
        const sortedKeys = Array.from(displayMap.keys()).sort();
        for (const key of sortedKeys) {
            const item = displayMap.get(key)!;
            const tags = item.source.map(s => `[${s}]`).join(" ");
            console.log(`${key} ${tags}`);
            console.log(`  Type: ${item.type}`);
            if (item.desc) console.log(`  Desc: ${item.desc}`);
            console.log("");
        }
        
        if (apiError) {
            console.log(`\n⚠️  Warning: Could not fetch live models list from API.`);
            console.log(`   Reason: ${apiError}`);
            console.log(`   (Shown list might be incomplete, relying on local registry)`);
        }
      }
    });
}
