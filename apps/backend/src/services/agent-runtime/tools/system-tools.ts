/**
 * @fileoverview services/agent-runtime/tools/system-tools.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createTool } from "@mastra/core/tools";
import { db } from "../../../db";
import { providerConfigs, users } from "../../../db/schema";
import type { AgentToolMap, AgentToolRuntimeContext } from "../types";

/**
 * createSystemTools function.
 *
 * Performs create system tools logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function createSystemTools(ctx: AgentToolRuntimeContext): AgentToolMap {
    const getSettings = createTool({
    id: "get_settings",
    description: "Get user account settings and default provider configuration.",
    inputSchema: z.object({}).default({}),
        execute: async () => {
            const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.userId),
      });
            const defaultProvider = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.isDefault, true),
      });
      return {
        user: user
          ? {
              id: user.id,
              email: user.email,
              name: user.name,
              timezone: user.timezone,
              hasPassword: Boolean(user.passwordHash),
              hasGoogle: Boolean(user.googleSub),
            }
          : null,
        defaultProvider: defaultProvider
          ? {
              id: defaultProvider.id,
              provider: defaultProvider.provider,
              model: defaultProvider.model,
              baseUrl: defaultProvider.baseUrl,
            }
          : null,
      };
    },
  });

    const listProviders = createTool({
    id: "list_providers",
    description: "List configured model provider connections.",
    inputSchema: z.object({
      onlyDefault: z.boolean().default(false),
    }),
        execute: async ({ onlyDefault }) => {
            const configs = onlyDefault
        ? await db.query.providerConfigs.findMany({
            where: eq(providerConfigs.isDefault, true),
          })
        : await db.query.providerConfigs.findMany();

      return {
        count: configs.length,
                items: configs.map((cfg) => ({
          id: cfg.id,
          provider: cfg.provider,
          model: cfg.model,
          baseUrl: cfg.baseUrl,
          isDefault: cfg.isDefault,
          hasApiKey: Boolean(cfg.apiKey),
          createdAt: cfg.createdAt,
        })),
      };
    },
  });

    const checkConnections = createTool({
    id: "check_connections",
    description:
      "Check basic connection readiness for provider configs (configuration-level health check).",
    inputSchema: z.object({
      provider: z.string().optional(),
    }),
        execute: async ({ provider }) => {
            const targetProvider = String(provider || "").trim();
            const rows = targetProvider
        ? await db.query.providerConfigs.findMany({
            where: and(eq(providerConfigs.provider, targetProvider)),
          })
        : await db.query.providerConfigs.findMany();

            const checks = rows.map((cfg) => {
                const issues: string[] = [];
        if (!cfg.model) issues.push("missing_model");
        if (!cfg.baseUrl && cfg.provider === "ollama") issues.push("missing_base_url");
        if (!cfg.apiKey && cfg.provider !== "ollama") issues.push("missing_api_key");
        return {
          id: cfg.id,
          provider: cfg.provider,
          model: cfg.model,
          isDefault: cfg.isDefault,
                    healthy: issues.length === 0,
          issues,
        };
      });

      return {
        count: checks.length,
                healthyCount: checks.filter((c) => c.healthy).length,
        checks,
      };
    },
  });

  return {
    getSettings,
    listProviders,
    checkConnections,
  };
}

