/**
 * @fileoverview services/agent-runtime/mcp.service.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { MCPClient, type MCPClientOptions } from "@mastra/mcp";
import type { AgentToolMap } from "./types";
import { getRuntimeConfig } from "../../config/runtime.config";

function normalizeServerConfig(raw: unknown): MCPClientOptions["servers"] {
  if (!raw || typeof raw !== "object") return {};
    const source = raw as Record<string, any>;
    const servers: MCPClientOptions["servers"] = {};
  for (const [name, cfg] of Object.entries(source)) {
    if (!cfg || typeof cfg !== "object") continue;
        const item = { ...(cfg as Record<string, any>) };
    if (typeof item.url === "string" && item.url.trim()) {
      try {
        item.url = new URL(item.url);
      } catch {
        continue;
      }
    }
    servers[name] = item as any;
  }
  return servers;
}

/**
 * AgentMcpService class.
 *
 * Encapsulates agent mcp service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class AgentMcpService {
    private static cachedClient: MCPClient | null = null;
  private static cachedKey = "";

    static isEnabled(): boolean {
    return getRuntimeConfig().agentRuntime.mcp.enabled;
  }

    private static getConfig(): MCPClientOptions | null {
        const runtime = getRuntimeConfig();
        const servers = normalizeServerConfig(runtime.agentRuntime.mcp.servers);
    if (!Object.keys(servers).length) return null;
    return {
      id: "main-agent-runtime",
      servers,
      timeout: runtime.agentRuntime.mcp.timeoutMs,
    };
  }

    private static async getClient(): Promise<MCPClient | null> {
    if (!this.isEnabled()) return null;
        const cfg = this.getConfig();
    if (!cfg) return null;

        const cacheKey = JSON.stringify({
      servers: cfg.servers,
      timeout: cfg.timeout,
    });
    if (!this.cachedClient || this.cachedKey !== cacheKey) {
      this.cachedClient = new MCPClient(cfg);
      this.cachedKey = cacheKey;
    }
    return this.cachedClient;
  }

    static async listToolsSafe(): Promise<{ tools: AgentToolMap; errors: string[] }> {
        const client = await this.getClient();
    if (!client) return { tools: {}, errors: [] };
    try {
            const tools = (await client.listTools()) as AgentToolMap;
      return { tools, errors: [] };
    } catch (err: any) {
      return {
        tools: {},
        errors: [String(err?.message || "Failed to load MCP tools")],
      };
    }
  }
}
