#!/usr/bin/env bun

import { Command } from "commander";
import { registerGenerate } from "./commands/generate.ts";
import { registerEdit } from "./commands/edit.ts";
import { registerGenerateSequential } from "./commands/generate-sequential.ts";
import { registerEditSequential } from "./commands/edit-sequential.ts";
import { registerModelsSelect } from "./commands/models-select.ts";
import { registerModels } from "./commands/models.ts";
import packageJson from "../package.json";

const program = new Command();

program
  .name("wavespeed")
  .description("Wavespeed AI CLI - Generate and Edit Images")
  .version(packageJson.version)
  .option("--model <modelId>", "Select model id (overrides config defaults)");

registerGenerate(program);
registerEdit(program);
registerGenerateSequential(program);
registerEditSequential(program);
registerModelsSelect(program);
registerModels(program);

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error("Fatal error:", err?.message ?? err);
  process.exit(1);
});