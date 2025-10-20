#!/usr/bin/env bun

import { Command } from "commander";
import { registerGenerate } from "./commands/generate.ts";
import { registerEdit } from "./commands/edit.ts";
import { registerGenerateSequential } from "./commands/generate-sequential.ts";
import { registerEditSequential } from "./commands/edit-sequential.ts";
import packageJson from "../package.json";

const program = new Command();

program
  .name("wavespeed")
  .description("Wavespeed CLI for Bytedance Seedream V4 models")
  .version(packageJson.version);

registerGenerate(program);
registerEdit(program);
registerGenerateSequential(program);
registerEditSequential(program);

program.parseAsync(process.argv).catch((err) => {
  console.error("Fatal error:", err?.message ?? err);
  process.exit(1);
});
