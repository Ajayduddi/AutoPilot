/**
 * @fileoverview apps/backend/src/services/agent/agent-execution.service.ts
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
import { Agent } from "@mastra/core/agent";
import {
  AutoModelRouterService,
  type AutoRouterCandidate,
} from "../ai-routing/auto-router.service";
import type { AgentToolMap } from "../agent-runtime/types";
import {
  buildAdaptiveAgentInstructions,
  buildAgentPrompt,
  maxAgentSteps,
} from "./agent-prompt.service";
import type { AgentCandidateAttempt } from "./agent-output.service";
import { getRuntimeConfig } from "../../config/runtime.config";

type StreamCallbacks = {
  onBlock: (index: number, block: { type: string; [key: string]: any }) => void;
  onChunk: (blockIndex: number, content: string) => void;
  onBlockEnd: (blockIndex: number) => void;
};

export function resolveAgentExecutionModel(candidate: AutoRouterCandidate): string {
  return getRuntimeConfig().agentRuntime.mastraAgentModel || candidate.mastraModel;
}

export async function runAgentGenerateAttempts(args: {
  candidates: AutoRouterCandidate[];
  history: any[];
  contextText: string;
  currentUserMessage: string;
  promptInput: {
    threadId: string;
    content: string;
    traceId: string;
    userId: string;
    providerId?: string;
    model?: string;
  };
  tools: AgentToolMap;
}): Promise<{
  attempts: AgentCandidateAttempt[];
  selected: AutoRouterCandidate | null;
  executedModel: string;
  output: any;
}> {
  const attempts: AgentCandidateAttempt[] = [];
  let output: any = null;
  let selected: AutoRouterCandidate | null = null;
  let executedModel = "";

  for (const candidate of args.candidates) {
    const startedAt = Date.now();
    try {
      const agentModel = resolveAgentExecutionModel(candidate);
      const agent = new Agent({
        id: "main-agent-runtime",
        name: "Main Agent Runtime",
        instructions: buildAdaptiveAgentInstructions({
          history: args.history,
          contextText: args.contextText,
          currentUserMessage: args.currentUserMessage,
        }),
        model: agentModel,
        tools: args.tools,
        defaultOptions: {
          maxSteps: maxAgentSteps(),
        },
      });
      output = await agent.generate(buildAgentPrompt(args.promptInput as any, args.contextText), {
        maxSteps: maxAgentSteps(),
      } as any);
      const latencyMs = Date.now() - startedAt;
      AutoModelRouterService.reportSuccess(candidate, latencyMs);
      attempts.push({ candidate, ok: true, latencyMs });
      selected = candidate;
      executedModel = agentModel;
      break;
    } catch (err: any) {
      AutoModelRouterService.reportFailure(candidate);
      attempts.push({
        candidate,
        ok: false,
        error: String(err?.message || err || "Unknown model failure"),
      });
    }
  }

  return { attempts, selected, executedModel, output };
}

export async function runAgentStreamingAttempts(args: {
  candidates: AutoRouterCandidate[];
  history: any[];
  contextText: string;
  currentUserMessage: string;
  promptInput: {
    threadId: string;
    content: string;
    traceId: string;
    userId: string;
    providerId?: string;
    model?: string;
  };
  tools: AgentToolMap;
  callbacks: StreamCallbacks;
}): Promise<{
  attempts: AgentCandidateAttempt[];
  selected: AutoRouterCandidate | null;
  executedModel: string;
  full: any;
  text: string;
}> {
  let selected: AutoRouterCandidate | null = null;
  let executedModel = "";
  let full: any = null;
  let text = "";
  const attempts: AgentCandidateAttempt[] = [];
  let streamShellOpened = false;

  for (const candidate of args.candidates) {
    const startedAt = Date.now();
    let emittedChunks = false;
    try {
      const agentModel = resolveAgentExecutionModel(candidate);
      const agent = new Agent({
        id: "main-agent-runtime",
        name: "Main Agent Runtime",
        instructions: buildAdaptiveAgentInstructions({
          history: args.history,
          contextText: args.contextText,
          currentUserMessage: args.currentUserMessage,
        }),
        model: agentModel,
        tools: args.tools,
        defaultOptions: {
          maxSteps: maxAgentSteps(),
        },
      });
      const stream = await agent.stream(
        buildAgentPrompt(args.promptInput as any, args.contextText),
        {
          maxSteps: maxAgentSteps(),
        } as any,
      );
      selected = candidate;
      executedModel = agentModel;

      if (!streamShellOpened) {
        args.callbacks.onBlock(0, {
          type: "summary",
          items: ["Main agent runtime (Mastra) is processing this request."],
        });
        args.callbacks.onBlockEnd(0);
        args.callbacks.onBlock(1, { type: "markdown", text: "" });
        streamShellOpened = true;
      }

      const reader = stream.textStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          emittedChunks = true;
          text += value;
          args.callbacks.onChunk(1, value);
        }
      }
      full = await stream.getFullOutput();
      const latencyMs = Date.now() - startedAt;
      AutoModelRouterService.reportSuccess(candidate, latencyMs);
      attempts.push({ candidate, ok: true, latencyMs });
      break;
    } catch (err: any) {
      AutoModelRouterService.reportFailure(candidate);
      attempts.push({
        candidate,
        ok: false,
        error: String(err?.message || err || "Unknown model failure"),
      });
      if (emittedChunks) {
        throw err;
      }
      selected = null;
      executedModel = "";
    }
  }

  return { attempts, selected, executedModel, full, text };
}
