import { Command } from "commander";
import prompts from "prompts";
import fs from "fs";
import path from "path";
import { loadConfig } from "../config/load";
import { getAllRegistryModels } from "../config/registry";
import { getModels } from "../api/client";
import { WavespeedConfig } from "../config/types";

export function registerModelsSelect(program: Command) {
  program
    .command("models-select")
    .description("Interactively select a default model")
    .action(async () => {
      const { config, path: configPath } = loadConfig();
      
      process.stdout.write("Fetching available models from API... ");
      
      // Get available models: Registry + Config + API
      const registryModels = getAllRegistryModels();
      
      // Config models
      const configModels = config?.models ? Object.entries(config.models).map(([id, m]) => ({
        id,
        title: id + (m.modelName ? ` (${m.modelName})` : ""),
        description: `Configured in ${configPath ? path.basename(configPath) : "config"}`,
        value: id
      })) : [];

      // API Models
      let apiChoices: any[] = [];
      const apiKey = process.env.WAVESPEED_API_KEY || 
                     config?.models?.[config?.defaults?.globalModel ?? ""]?.apiKeyEnv && process.env[config!.models![config!.defaults!.globalModel!]!.apiKeyEnv!];

      if (apiKey) {
         try {
             const apiModels = await getModels(apiKey);
             process.stdout.write("Done.\n");
             
             apiChoices = apiModels.map(m => ({
                 title: m.name || m.model_id,
                 description: `[API] ${m.description || m.type}`,
                 value: m.model_id
             }));
         } catch (err) {
             process.stdout.write("Failed (using local list).\n");
         }
      } else {
          process.stdout.write("Skipped (no API key).\n");
      }

      // Filter duplicates: Config > Registry > API
      // We want to present a unified list
      
      // 1. Registry models (filter if in config)
      const registryChoices = registryModels
        .filter(rm => !configModels.find(cm => cm.id === rm.id))
        .map(rm => ({
          title: rm.name,
          description: rm.description,
          value: rm.id
        }));
        
      // 2. API models (filter if in config OR registry)
      const uniqueApiChoices = apiChoices.filter(am => 
          !configModels.find(cm => cm.id === am.value) &&
          !registryModels.find(rm => rm.id === am.value)
      );

      const rawChoices = [
        { title: '--- Configured ---', disabled: true },
        ...configModels,
        { title: '--- Registry (Built-in) ---', disabled: true },
        ...registryChoices,
        ...(uniqueApiChoices.length ? [{ title: '--- API (Live) ---', disabled: true }, ...uniqueApiChoices] : [])
      ];

      const choices = rawChoices.filter((c, index, arr) => {
          if (!c.disabled) return true; // Keep normal items
          
          // It's a header (disabled=true). Keep it only if the NEXT item is NOT a header and exists.
          const next = arr[index + 1];
          return next && !next.disabled;
      });

      const currentDefault = config?.defaults?.globalModel;
      let initialIndex = choices.findIndex(c => c.value === currentDefault);
      if (initialIndex < 0) initialIndex = 1; // Skip first header

      const response = await prompts({
        type: 'select',
        name: 'modelId',
        message: 'Select a default model for global use:',
        choices,
        initial: initialIndex
      });

      if (!response.modelId) {
        console.log("Selection cancelled.");
        return;
      }

      const selectedId = response.modelId;

      // Determine where to save
      let savePath = configPath;
      if (!savePath) {
        // Create new config in current directory if none exists
        savePath = path.join(process.cwd(), ".wavespeedrc.json");
        console.log(`No config file found. Creating new one at: ${savePath}`);
      }

      try {
        // If file doesn't exist or is empty, init basic structure
        let newConfig: WavespeedConfig = config || { models: {} };
        
        if (!newConfig.defaults) {
            newConfig.defaults = {};
        }
        
        newConfig.defaults.globalModel = selectedId;

        fs.writeFileSync(savePath, JSON.stringify(newConfig, null, 2));
        console.log(`\n✅ Successfully set default model to: ${selectedId}`);
        console.log(`Updated config file: ${savePath}`);

      } catch (err: any) {
        console.error(`Failed to save config: ${err.message}`);
        process.exit(1);
      }
    });
}
