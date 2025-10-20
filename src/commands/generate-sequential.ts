import { Command } from "commander";
import { submitTask, endpoints } from "../api/client.ts";
import { pollUntilDone } from "../utils/polling.ts";
import { ensurePrompt, parseSize, parseMaxImages } from "../utils/validation.ts";
import { TaskData } from "../api/types.ts";
import { saveImagesFromOutputs } from "../utils/images.ts";

function printResult(d: TaskData, base64: boolean) {
  console.log("Task ID:", d.id);
  console.log("Status:", d.status);
  if (d.timings?.inference != null) {
    console.log("Inference time ms:", d.timings.inference);
  }
  if (d.has_nsfw_contents && d.has_nsfw_contents.some(Boolean)) {
    console.warn("Warning: NSFW content flagged in one or more outputs");
  }
  if (d.outputs?.length) {
    if (base64) {
      console.log("Outputs base64:");
    } else {
      console.log("Outputs urls:");
    }
    d.outputs.forEach((o, idx) => console.log(`${idx + 1}. ${o}`));
  }
}

export function registerGenerateSequential(program: Command) {
  program
    .command("generate-sequential")
    .description("Sequential text-to-image generation with consistency")
    .option("-p, --prompt [value]", "Prompt text")
    .option("-m, --max-images [value]", "Max images, default 1")
    .option("-s, --size [value]", "Image size WIDTH*HEIGHT, default 2048*2048")
    .option("-o, --output-dir <dir>", "Directory to save downloaded images (default: ./output/)", "./output/")
    .option("--base64", "Request base64 outputs from API (auto-decoded and saved)")
    .option("--sync", "Enable synchronous mode (wait for result before returning)")
    .addHelpText("after", `
Notes:
  - Images are automatically downloaded when the task completes.
  - Files are saved to --output-dir as {taskId}_1.png, {taskId}_2.png, etc.
  - Use --base64 to request base64 outputs; the CLI will decode and save them as .png files.
  - Use --sync for synchronous processing (waits for completion before returning).
`)
    .action(async (opts) => {
      try {
        const prompt = ensurePrompt(opts.prompt);
        const max_images = parseMaxImages(opts.maxImages);
        const size = parseSize(opts.size);
        const base64 = Boolean(opts.base64);
        const syncMode = Boolean(opts.sync);
        const outputDir = opts.outputDir;

        const payload = { 
          prompt, 
          max_images, 
          size, 
          enable_base64_output: base64,
          enable_sync_mode: syncMode 
        };
        const created = await submitTask(endpoints.generateSequential, payload);

        const final = await pollUntilDone(created.id);
        if (final.status === "failed") {
          throw new Error(final.error || "Task failed");
        }
        printResult(final, base64);

        // Download and save images
        const outputs = final.outputs || [];
        if (!outputs.length) {
          console.warn("No images were returned by the API.");
        } else {
          const { savedPaths, failed } = await saveImagesFromOutputs(outputs, outputDir, final.id);
          console.log("\nSaved files:");
          savedPaths.forEach(p => console.log(`  ${p}`));
          if (failed.length) {
            console.warn(`\nFailed to save ${failed.length} image(s):`);
            failed.forEach(f => console.warn(`  #${f.index + 1}: ${f.reason}`));
          }
          if (!savedPaths.length) {
            process.exit(1);
          }
        }
      } catch (err: any) {
        console.error("generate-sequential error:", err?.message ?? err);
        process.exit(1);
      }
    });
}
