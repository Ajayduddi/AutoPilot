/**
 * @fileoverview services/main-agent.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { LLMService } from "./llm.service";
import { WorkflowService } from "./workflow.service";
import type { ConversationMessage, RetrievedContext } from "../providers/llm/provider.interface";
import { getRuntimeConfig } from "../config/runtime.config";

/**
 * AgentRiskLevel type alias.
 */
export type AgentRiskLevel = "low" | "medium" | "high";

/**
 * AgentConfidence type alias.
 */
export type AgentConfidence = "low" | "medium" | "high";

/**
 * ReActObservation type alias.
 */
export type ReActObservation = {
    phase: "understand" | "observe" | "act" | "risk" | "approval" | "answer";
    summary: string;
  details?: string[];
};

/**
 * ReActCandidateSnapshot type alias.
 */
export type ReActCandidateSnapshot = {
    workflowKey: string;
    workflowName: string;
    score: number;
    reasons: string[];
};

/**
 * ReActState type alias.
 */
export type ReActState = {
    goal: string;
    intentType: "chat" | "workflow";
  requestedWorkflowKey?: string;
    candidateCount: number;
    shortlistedCandidates: ReActCandidateSnapshot[];
  selectedWorkflowKey?: string;
  selectedWorkflowName?: string;
    evidenceSources: string[];
    missingEvidence: string[];
    confidence: AgentConfidence;
    nextAction: string;
    observations: ReActObservation[];
};

type AgentDecisionBase = {
    planId: string;
    planStepId: string;
    reasoning: string;
    reactState: ReActState;
};

/**
 * AgentDecision type alias.
 */
export type AgentDecision =
  | (AgentDecisionBase & {
            mode: "chat";
      finalReply?: string;
      selectedSubagent?: undefined;
      riskEvaluation?: undefined;
      requiresApproval?: false;
    })
  | (AgentDecisionBase & {
            mode: "workflow";
      selectedSubagent: {
                workflowId: string;
                workflowKey: string;
                workflowName: string;
                provider: string;
      };
      riskEvaluation: {
                level: AgentRiskLevel;
                reason: string;
      };
            requiresApproval: boolean;
    });

type WorkflowCandidate = {
    id: string;
    key: string;
    name: string;
    description: string | null;
    provider: string;
    enabled: boolean;
    archived: boolean;
    requiresApproval: boolean;
    executionEndpoint: string | null;
    tags: string[];
    metadata: Record<string, unknown> | null;
};

type CandidateObservation = {
    candidate: WorkflowCandidate;
    score: number;
    reasons: string[];
};

function normalizeRisk(metadata: Record<string, unknown> | null): AgentRiskLevel {
    const direct = typeof metadata?.riskLevel === "string" ? metadata.riskLevel : undefined;
    const nested = metadata?.agent && typeof metadata.agent === "object"
    ? (metadata.agent as Record<string, unknown>).riskLevel
    : undefined;
    const val = String(direct ?? nested ?? "low").toLowerCase();
  if (val === "high" || val === "medium" || val === "low") return val;
  return "low";
}

function getCapabilities(metadata: Record<string, unknown> | null): string[] {
    const direct = Array.isArray(metadata?.agentCapabilities) ? metadata?.agentCapabilities : [];
    const nested = metadata?.agent && typeof metadata.agent === "object"
    ? (metadata.agent as Record<string, unknown>).capabilities
    : [];
    const raw = Array.isArray(nested) ? nested : direct;
  return raw.map((v) => String(v).toLowerCase().trim()).filter(Boolean);
}

function getRequiresApprovalOverride(metadata: Record<string, unknown> | null): boolean | undefined {
    const direct = metadata?.requiresApprovalOverride;
    const nested = metadata?.agent && typeof metadata.agent === "object"
    ? (metadata.agent as Record<string, unknown>).requiresApprovalOverride
    : undefined;
    const val = direct ?? nested;
  if (typeof val === "boolean") return val;
  return undefined;
}

function createPlanIds() {
    const seed = Math.random().toString(36).slice(2, 10);
  return {
    planId: `plan_${seed}`,
    planStepId: `step_${seed}`,
  };
}

function normalizedText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizedText(value)
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function scoreWorkflowCandidate(candidate: WorkflowCandidate, message: string, context?: RetrievedContext): CandidateObservation {
    const text = normalizedText(`${message}\n${context?.formatted || ""}`);
    const queryTokens = new Set(tokenize(text));
    const reasons: string[] = [];
    let score = 0;

    const key = normalizedText(candidate.key);
    const name = normalizedText(candidate.name);
    const description = normalizedText(candidate.description || "");
    const tags = (candidate.tags || []).map((tag) => normalizedText(tag));
    const capabilities = getCapabilities(candidate.metadata);

  if (key && text.includes(key)) {
    score += 14;
    reasons.push(`Exact workflow key match: ${candidate.key}`);
  }
  if (name && text.includes(name)) {
    score += 11;
    reasons.push(`Workflow name mentioned: ${candidate.name}`);
  }

  for (const tag of tags) {
    if (tag && text.includes(tag)) {
      score += 4;
      reasons.push(`Tag overlap: ${tag}`);
    }
  }

  for (const capability of capabilities) {
    if (capability && text.includes(capability)) {
      score += 5;
      reasons.push(`Capability match: ${capability}`);
    }
  }

    const candidateTokens = new Set([
    ...tokenize(key.replace(/[_-]+/g, " ")),
    ...tokenize(name),
    ...tokenize(description).slice(0, 24),
    ...tags.flatMap((tag) => tokenize(tag)),
    ...capabilities.flatMap((capability) => tokenize(capability)),
  ]);

    let overlap = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) overlap += 1;
  }
  if (overlap > 0) {
    score += Math.min(10, overlap);
    reasons.push(`Token overlap: ${overlap}`);
  }

  if (!candidate.requiresApproval) {
    score += 1;
  }

  return { candidate, score, reasons };
}

function formatReasoning(lines: string[]): string {
  return lines.filter(Boolean).join(" ");
}

function pushObservation(
  state: ReActState,
  phase: ReActObservation["phase"],
  summary: string,
  details?: string[],
) {
  state.observations.push({ phase, summary, details: details?.filter(Boolean) });
}

function toCandidateSnapshot(observation: CandidateObservation): ReActCandidateSnapshot {
  return {
    workflowKey: observation.candidate.key,
    workflowName: observation.candidate.name,
    score: observation.score,
    reasons: observation.reasons.slice(0, 4),
  };
}

function deriveConfidence(top?: CandidateObservation, second?: CandidateObservation): AgentConfidence {
  if (!top || top.score <= 0) return "low";
    const gap = top.score - (second?.score ?? 0);
  if (top.score >= 10 && gap >= 4) return "high";
  if (top.score >= 5 && gap >= 2) return "medium";
  return "low";
}

function createReActState(goal: string): ReActState {
  return {
    goal,
    intentType: "chat",
    candidateCount: 0,
    shortlistedCandidates: [],
    evidenceSources: [],
    missingEvidence: [],
    confidence: "medium",
    nextAction: "understand_request",
    observations: [],
  };
}

/**
 * extendDecisionReActState function.
 *
 * Performs extend decision re act state logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function extendDecisionReActState(
  decision: AgentDecision,
  patch: {
    observation?: ReActObservation;
    nextAction?: string;
    confidence?: AgentConfidence;
    evidenceSource?: string;
    missingEvidence?: string[];
  },
): AgentDecision {
    const nextState: ReActState = {
    ...decision.reactState,
    evidenceSources: [...decision.reactState.evidenceSources],
    missingEvidence: [...decision.reactState.missingEvidence],
        shortlistedCandidates: decision.reactState.shortlistedCandidates.map((item) => ({ ...item, reasons: [...item.reasons] })),
        observations: decision.reactState.observations.map((item) => ({ ...item, details: item.details ? [...item.details] : undefined })),
  };

  if (patch.observation) {
    nextState.observations.push({
      phase: patch.observation.phase,
      summary: patch.observation.summary,
      details: patch.observation.details ? [...patch.observation.details] : undefined,
    });
  }
  if (patch.nextAction) nextState.nextAction = patch.nextAction;
  if (patch.confidence) nextState.confidence = patch.confidence;
  if (patch.evidenceSource && !nextState.evidenceSources.includes(patch.evidenceSource)) {
    nextState.evidenceSources.push(patch.evidenceSource);
  }
  if (patch.missingEvidence?.length) {
    for (const item of patch.missingEvidence) {
      if (item && !nextState.missingEvidence.includes(item)) nextState.missingEvidence.push(item);
    }
  }

  return {
    ...decision,
    reactState: nextState,
  };
}

function buildClarificationReply(observations: CandidateObservation[]): string {
    const top = observations.slice(0, 3).map((obs, idx) => `${idx + 1}. ${obs.candidate.name} (\`${obs.candidate.key}\`)`);
  return `I found multiple plausible workflows and need a more explicit target before executing anything:\n\n${top.join("\n")}`;
}

async function loadWorkflowCandidates(): Promise<WorkflowCandidate[]> {
    const all = await WorkflowService.getAll({ archived: false, enabled: true });
  return (all as WorkflowCandidate[]).filter((wf) => !!wf.executionEndpoint && !wf.archived && wf.enabled);
}

function evaluateRisk(candidate: WorkflowCandidate): {
    level: AgentRiskLevel;
    reason: string;
    requiresApproval: boolean;
} {
    const riskLevel = normalizeRisk(candidate.metadata);
    const override = getRequiresApprovalOverride(candidate.metadata);
    const approvalMode = getRuntimeConfig().approvalMode;
    const requiresApproval =
    approvalMode === "auto"
      ? false
      : typeof override === "boolean"
        ? override
        : candidate.requiresApproval || riskLevel !== "low";

    const riskReason = requiresApproval
    ? `Guarded policy requires approval for ${riskLevel}-risk subagent.`
    : approvalMode === "auto"
      ? "Auto-approval mode enabled; execution can proceed without approval gate."
      : "Low-risk subagent can run automatically.";

  return {
    level: riskLevel,
    reason: riskReason,
    requiresApproval,
  };
}

/**
 * MainAgentService class.
 *
 * Encapsulates main agent service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class MainAgentService {
  static async decide(input: {
        userMessage: string;
    providerId?: string;
    model?: string;
    history?: ConversationMessage[];
    context?: RetrievedContext;
    executionAllowed?: boolean;
  }): Promise<AgentDecision> {
        const ids = createPlanIds();
        const reasoning: string[] = [];
        const maxIterations = 3;
        const executionAllowed = input.executionAllowed ?? true;
        const reactState = createReActState(input.userMessage);

    reasoning.push(`Plan initialized (${ids.planId}/${ids.planStepId}).`);
    pushObservation(reactState, "understand", `Plan initialized for goal: ${input.userMessage.slice(0, 160)}`);

        const intent = await LLMService.parseIntent(
      input.userMessage,
      input.providerId,
      input.model,
      input.history,
      input.context,
      { routingHint: "reasoning_heavy" },
    );
    reactState.intentType = intent.type;
    reactState.requestedWorkflowKey = intent.workflowKey || undefined;
    reactState.nextAction = intent.type === "workflow" ? "evaluate_workflow_candidates" : "answer_directly";
    reasoning.push(`Understand: intent classified as ${intent.type}${intent.workflowKey ? ` (${intent.workflowKey})` : ""}.`);
    pushObservation(
      reactState,
      "understand",
      `Intent classified as ${intent.type}${intent.workflowKey ? ` (${intent.workflowKey})` : ""}.`,
      intent.reply ? [`Fallback reply prepared: ${intent.reply.slice(0, 160)}`] : undefined,
    );

    if (intent.type !== "workflow") {
      reasoning.push("Finalize: chat mode selected because no workflow execution is needed.");
      reactState.confidence = "high";
      reactState.nextAction = "answer_directly";
      pushObservation(reactState, "answer", "Workflow execution not required; answering directly.");
      return {
        mode: "chat",
        planId: ids.planId,
        planStepId: ids.planStepId,
        reasoning: formatReasoning(reasoning),
        reactState,
        finalReply: intent.reply,
        requiresApproval: false,
      };
    }

        const candidates = await loadWorkflowCandidates();
    reactState.candidateCount = candidates.length;
    reasoning.push(`Observe: loaded ${candidates.length} enabled workflow candidates.`);
    pushObservation(reactState, "observe", `Loaded ${candidates.length} executable workflows from the registry.`);

        let selected: WorkflowCandidate | undefined;
        let ranked: CandidateObservation[] = [];
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      reasoning.push(`ReAct iteration ${iteration}: shortlist and evaluate candidates.`);
      ranked = candidates
        .map((candidate) => scoreWorkflowCandidate(candidate, input.userMessage, input.context))
        .sort((a, b) => b.score - a.score);
      reactState.shortlistedCandidates = ranked.slice(0, 3).map(toCandidateSnapshot);

      if (intent.workflowKey) {
        selected = ranked.find((entry) => entry.candidate.key === intent.workflowKey)?.candidate;
        if (selected) {
          reactState.selectedWorkflowKey = selected.key;
          reactState.selectedWorkflowName = selected.name;
          reactState.confidence = "high";
          reactState.nextAction = "evaluate_risk";
          reasoning.push(`Act: exact workflow key resolved to ${selected.name} (${selected.key}).`);
          pushObservation(reactState, "act", `Resolved exact workflow key to ${selected.name} (${selected.key}).`);
          break;
        }
        reasoning.push(`Observe: requested workflow key "${intent.workflowKey}" was not found in the executable shortlist.`);
        pushObservation(
          reactState,
          "observe",
          `Requested workflow key "${intent.workflowKey}" was not found among executable workflows.`,
          ["The planner will continue with ranked shortlist matching."],
        );
      }

            const top = ranked[0];
            const second = ranked[1];
      reactState.confidence = deriveConfidence(top, second);
      if (!top || top.score <= 0) {
        reasoning.push("Observe: no candidate had meaningful relevance.");
        reactState.nextAction = "ask_for_clarification";
        reactState.missingEvidence = ["A more explicit workflow target or richer request context."];
        pushObservation(reactState, "observe", "No executable workflow had strong relevance to the request.");
        break;
      }

            const ambiguityGap = top.score - (second?.score ?? 0);
      reasoning.push(`Observe: top candidate ${top.candidate.key} scored ${top.score}${second ? `, next best scored ${second.score}` : ""}.`);
      pushObservation(
        reactState,
        "observe",
        `Top candidate ${top.candidate.key} scored ${top.score}${second ? ` vs ${second.candidate.key} at ${second.score}` : ""}.`,
        top.reasons.slice(0, 4),
      );

      if (ambiguityGap >= 4 || !second) {
        selected = top.candidate;
        reactState.selectedWorkflowKey = selected.key;
        reactState.selectedWorkflowName = selected.name;
        reactState.nextAction = "evaluate_risk";
        reasoning.push(`Act: selected ${selected.name} (${selected.key}) after shortlist evaluation.`);
        pushObservation(reactState, "act", `Selected ${selected.name} (${selected.key}) after shortlist evaluation.`);
        break;
      }

      reasoning.push("Observe: top workflow match is ambiguous; avoiding unsafe auto-selection.");
      reactState.nextAction = "ask_for_clarification";
      reactState.missingEvidence = ["A clearer workflow target to resolve ambiguity safely."];
      pushObservation(reactState, "observe", "Top workflow match remained ambiguous; auto-selection was rejected.");
      selected = undefined;
      break;
    }

    if (!selected) {
      reasoning.push("Finalize: falling back to chat because workflow selection remained ambiguous.");
      reactState.confidence = "low";
      reactState.nextAction = "ask_for_clarification";
      pushObservation(reactState, "answer", "Planner is falling back to clarification instead of workflow execution.");
      return {
        mode: "chat",
        planId: ids.planId,
        planStepId: ids.planStepId,
        reasoning: formatReasoning(reasoning),
        reactState,
        finalReply: ranked.length > 1 ? buildClarificationReply(ranked) : intent.reply,
        requiresApproval: false,
      };
    }

    if (!executionAllowed) {
      reasoning.push("Finalize: execution disabled for this turn, so the agent will not trigger the selected workflow.");
      reactState.nextAction = "report_selected_workflow_without_execution";
      pushObservation(reactState, "answer", `Execution disabled; reporting selected workflow ${selected.key} without triggering it.`);
      return {
        mode: "chat",
        planId: ids.planId,
        planStepId: ids.planStepId,
        reasoning: formatReasoning(reasoning),
        reactState,
        finalReply: `I found the likely workflow to use: ${selected.name} (\`${selected.key}\`), but execution is disabled for this turn.`,
        requiresApproval: false,
      };
    }

        const risk = evaluateRisk(selected);
    reactState.nextAction = risk.requiresApproval ? "request_approval" : "execute_workflow";
    reasoning.push(`Risk check: ${risk.level}. ${risk.reason}`);
    reasoning.push("Finalize: workflow mode selected for orchestrator execution.");
    pushObservation(reactState, "risk", `Risk evaluated as ${risk.level}. ${risk.reason}`);
    pushObservation(
      reactState,
      risk.requiresApproval ? "approval" : "act",
      risk.requiresApproval
        ? `Workflow ${selected.key} requires approval before execution.`
        : `Workflow ${selected.key} can execute immediately.`,
    );

    return {
      mode: "workflow",
      planId: ids.planId,
      planStepId: ids.planStepId,
      reasoning: formatReasoning(reasoning),
      reactState,
      selectedSubagent: {
        workflowId: selected.id,
        workflowKey: selected.key,
        workflowName: selected.name,
        provider: selected.provider,
      },
      riskEvaluation: {
        level: risk.level,
        reason: risk.reason,
      },
      requiresApproval: risk.requiresApproval,
    };
  }
}
