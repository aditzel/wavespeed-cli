#!/usr/bin/env bun

import { Command } from "commander";
import packageJson from "../package.json";
import { registerEdit } from "./commands/edit.ts";
import { registerEditSequential } from "./commands/edit-sequential.ts";
import { registerGenerate } from "./commands/generate.ts";
import { registerGenerateSequential } from "./commands/generate-sequential.ts";
import { registerMCP } from "./commands/mcp.ts";
import { registerModels } from "./commands/models.ts";
import { registerModelsSelect } from "./commands/models-select.ts";

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
registerMCP(program);

async function main() {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error("Fatal error:", err?.message ?? err);
  process.exit(1);
});
