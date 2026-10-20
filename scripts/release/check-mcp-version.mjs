import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { releaseVersion } from "./versioned-artifact.mjs";

const expected = releaseVersion(process.argv[2]);
const client = new Client({ name: "wavespeed-release-check", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js", "mcp"],
  env: process.env,
  stderr: "inherit",
});
// Only the protocol handshake is used; no generation tool or API is called.
const deadline = setTimeout(() => {
  console.error("MCP version check timed out");
  process.exit(1);
}, 10_000);
try {
  await client.connect(transport);
  if (client.getServerVersion()?.version !== expected) throw new Error("MCP version mismatch");
  console.log(`MCP version verified: ${expected}`);
} finally {
  await client.close();
  clearTimeout(deadline);
}
