import type { Command } from "commander";
import { WavespeedMCPServer } from "../mcp";

export function registerMCP(program: Command) {
  program
    .command("mcp")
    .description("Start the Wavespeed MCP server (stdio-based)")
    .action(async () => {
      try {
        const server = new WavespeedMCPServer();
        await server.start();
      } catch (err) {
        console.error("MCP server error:", (err as Error)?.message ?? err);
        process.exit(1);
      }
    });
}
