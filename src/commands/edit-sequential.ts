import type { Command } from "commander";
import { endpoints, submitTask } from "../api/client.ts";
import type { TaskData } from "../api/types.ts";
import { loadConfig } from "../config/load";
import { ConfigError, resolveModel } from "../config/models";
import { saveImagesFromOutputs } from "../utils/images.ts";
import { pollUntilDone } from "../utils/polling.ts";
import { ensurePrompt, parseImagesList, parseMaxImages, parseSize } from "../utils/validation.ts";

function printResult(d: TaskData, base64: boolean) {
  console.log("Task ID:", d.id);
  console.log("Status:", d.status);
  if (d.timings?.inference != null) {
    console.log("Inference time ms:", d.timings.inference);
  }
  if (d.has_nsfw_contents?.some(Boolean)) {
    console.warn("Warning: NSFW content flagged in one or more outputs");
  }
  if (d.outputs?.length) {
    if (base64) {
      console.log("Outputs base64:");
    } else {
      console.log("Outputs urls:");
    }
    d.outputs.forEach((o, idx) => {
      console.log(`${idx + 1}. ${o}`);
    });
  }
}

export function registerEditSequential(program: Command) {
  program
    .command("edit-sequential")
    .description("Sequential image editing with consistency")
    .option("-p, --prompt [value]", "Prompt text")
    .option("-i, --images [value]", "Comma separated image URLs or file paths, max 10")
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
        const images = await parseImagesList(opts.images, false, 10);
        const max_images = parseMaxImages(opts.maxImages);
        const size = parseSize(opts.size);
        const base64 = Boolean(opts.base64);
        const syncMode = Boolean(opts.sync);
        const outputDir = opts.outputDir;

        const rootOpts =
          command.parent && typeof command.parent.opts === "function" ? command.parent.opts() : {};
        const cliModelFlag = opts.model ?? rootOpts.model;

        const { config } = loadConfig();
        const model = resolveModel("edit-sequential", cliModelFlag, config);

        const payload: Record<string, unknown> = {
          prompt,
          max_images,
          size,
          enable_base64_output: base64,
          enable_sync_mode: syncMode,
          model: model.modelName ?? model.id,
        };
        if (images.length) {
          payload.images = images;
        }

        const created = await submitTask(model, endpoints.editSequential, payload);

        const final = await pollUntilDone(created.id);
        if (final.status === "failed") {
          throw new Error(final.error || "Task failed");
        }
        printResult(final, base64);

        const outputs = final.outputs || [];
        if (!outputs.length) {
          console.warn("No images were returned by the API.");
        } else {
          const { savedPaths, failed } = await saveImagesFromOutputs(outputs, outputDir, final.id);
          console.log("\nSaved files:");
          savedPaths.forEach((p) => {
            console.log(`  ${p}`);
          });
          if (failed.length) {
            console.warn(`\nFailed to save ${failed.length} image(s):`);
            failed.forEach((f) => {
              console.warn(`  #${f.index + 1}: ${f.reason}`);
            });
          }
          if (!savedPaths.length) {
            process.exit(1);
          }
        }
      } catch (err: unknown) {
        if (err instanceof ConfigError) {
          console.error(err.message);
          process.exit(err.exitCode);
        }
        console.error("edit-sequential error:", (err as Error)?.message ?? err);
        process.exit(1);
      }
    });
}
