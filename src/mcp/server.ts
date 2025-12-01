import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../../package.json";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import { registerTools } from "./tools";

/**
 * Wavespeed MCP Server
 * Exposes image generation capabilities via Model Context Protocol
 */
export class WavespeedMCPServer {
  private server: McpServer;

  constructor() {
    this.server = new McpServer({
      name: "wavespeed",
      version: packageJson.version,
    });

    this.initialize();
  }

  private initialize(): void {
    // Register all MCP capabilities
    registerTools(this.server);
    registerResources(this.server);
    registerPrompts(this.server);
  }

  /**
   * Start the MCP server on stdio transport
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Log to stderr so it doesn't interfere with stdio protocol
    console.error(`Wavespeed MCP server v${packageJson.version} running on stdio`);
  }
}
