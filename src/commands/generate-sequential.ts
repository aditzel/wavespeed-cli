import type { Command } from "commander";
import { loadConfig } from "../config/load";
import { ConfigError, resolveModel } from "../config/models";
import { formatForCLI, generateSequential } from "../core";
import { ensurePrompt, parseMaxImages, parseSize } from "../utils/validation.ts";

export function registerGenerateSequential(program: Command) {
  program
    .command("generate-sequential")
    .description("Sequential text-to-image generation with consistency")
    .option("-p, --prompt [value]", "Prompt text")
    .option("-m, --max-images [value]", "Max images, default 1")
    .option("-s, --size [value]", "Image size WIDTH*HEIGHT, default 2048*2048")
    .option(
      "-o, --output-dir <dir>",
      "Directory to save downloaded images (default: ./output/)",
      "./output/",
    )
    .option("--base64", "Request base64 outputs from API (auto-decoded and saved)")
    .option("--sync", "Enable synchronous mode (wait for result before returning)")
    .action(async (opts, command) => {
      try {
        const prompt = ensurePrompt(opts.prompt);
        const maxImages = parseMaxImages(opts.maxImages);
        const size = parseSize(opts.size);
        const base64 = Boolean(opts.base64);
        const syncMode = Boolean(opts.sync);
        const outputDir = opts.outputDir;

        const rootOpts =
          command.parent && typeof command.parent.opts === "function" ? command.parent.opts() : {};
        const cliModelFlag = opts.model ?? rootOpts.model;

        const { config } = loadConfig();
        const model = resolveModel("generate-sequential", cliModelFlag, config);

        // Use core operation
        const result = await generateSequential({
          prompt,
          maxImages,
          size,
          base64Output: base64,
          syncMode,
          model,
        });

        if (!result.success) {
          throw new Error(result.error || "Task failed");
        }

        // Format and display for CLI
        const { savedPaths } = await formatForCLI(result, outputDir, base64);

        if (!savedPaths.length && result.outputs.length) {
          process.exit(1);
        }
      } catch (err) {
        const error = err as Error | ConfigError;
        if (error instanceof ConfigError) {
          console.error(error.message);
          process.exit(error.exitCode);
        }
        console.error("generate-sequential error:", error?.message ?? error);
        process.exit(1);
      }
    });
}
