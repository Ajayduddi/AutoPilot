/**
 * @fileoverview Helper utilities for spinning up and tearing down ephemeral
 * Express servers in E2E tests.
 */
import express, { type Express } from "express";
import type { Server } from "http";
import { traceMiddleware } from "../../../src/middleware/trace.middleware";
import { errorMiddleware } from "../../../src/middleware/error.middleware";
import { UserRepo } from "../../../src/repositories/user.repo";
import { AuthService } from "../../../src/services/auth/auth.service";
import { ChatRepo } from "../../../src/repositories/chat.repo";
import { ChatService } from "../../../src/services/chat.service";
import { OrchestratorService } from "../../../src/services/orchestrator/orchestrator.service";
import { AgentService } from "../../../src/services/agent/agent.service";
import { WorkflowService } from "../../../src/services/workflow/workflow.service";
import { NotificationService } from "../../../src/services/notifications/notification.service";
import { ApprovalRepo } from "../../../src/repositories/approval.repo";

// Store original methods to restore them after each test
export const originalModules = {
  canUseAsSingleUser: UserRepo.canUseAsSingleUser,
  getByEmail: UserRepo.getByEmail,
  verifyPassword: AuthService.verifyPassword,
  verifyTotpForPendingSession: (AuthService as any).verifyTotpForPendingSession,
  createSessionForUser: AuthService.createSessionForUser,
  logoutByCookie: AuthService.logoutByCookie,
  ensureThread: ChatRepo.ensureThread,
  getAttachmentsByIds: ChatRepo.getAttachmentsByIds,
  linkAttachmentsToMessage: ChatRepo.linkAttachmentsToMessage,
  addMessage: ChatService.addMessage,
  handleIncomingMessage: OrchestratorService.handleIncomingMessage,
  handleStreamingMessage: OrchestratorService.handleStreamingMessage,
  agentEnabled: AgentService.isEnabled,
  agentStreamingMessage: AgentService.handleStreamingMessage,
  getWorkflowById: WorkflowService.getById,
  executeWorkflow: WorkflowService.execute,
  getRunById: WorkflowService.getRunById,
  updateRunStatus: WorkflowService.updateRunStatus,
  shouldNotifyWorkflowRun: NotificationService.shouldNotifyWorkflowRun,
  getPendingApprovals: ApprovalRepo.getPendingApprovals,
  resolveApproval: ApprovalRepo.resolveApproval,
};

/**
 * Restores all monkey-patched module methods captured in `originalModules`.
 */
export function restoreMocks() {
  (UserRepo as any).canUseAsSingleUser = originalModules.canUseAsSingleUser;
  (UserRepo as any).getByEmail = originalModules.getByEmail;
  (AuthService as any).verifyPassword = originalModules.verifyPassword;
  (AuthService as any).verifyTotpForPendingSession = originalModules.verifyTotpForPendingSession;
  (AuthService as any).createSessionForUser = originalModules.createSessionForUser;
  (AuthService as any).logoutByCookie = originalModules.logoutByCookie;
  (ChatRepo as any).ensureThread = originalModules.ensureThread;
  (ChatRepo as any).getAttachmentsByIds = originalModules.getAttachmentsByIds;
  (ChatRepo as any).linkAttachmentsToMessage = originalModules.linkAttachmentsToMessage;
  (ChatService as any).addMessage = originalModules.addMessage;
  (OrchestratorService as any).handleIncomingMessage = originalModules.handleIncomingMessage;
  (OrchestratorService as any).handleStreamingMessage = originalModules.handleStreamingMessage;
  (AgentService as any).isEnabled = originalModules.agentEnabled;
  (AgentService as any).handleStreamingMessage = originalModules.agentStreamingMessage;
  (WorkflowService as any).getById = originalModules.getWorkflowById;
  (WorkflowService as any).execute = originalModules.executeWorkflow;
  (WorkflowService as any).getRunById = originalModules.getRunById;
  (WorkflowService as any).updateRunStatus = originalModules.updateRunStatus;
  (NotificationService as any).shouldNotifyWorkflowRun = originalModules.shouldNotifyWorkflowRun;
  (ApprovalRepo as any).getPendingApprovals = originalModules.getPendingApprovals;
  (ApprovalRepo as any).resolveApproval = originalModules.resolveApproval;
}

/**
 * Starts an ephemeral test server and returns base URL plus async close helper.
 */
export async function withServer(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  // Ensure tests use the same centralized API error shape as production routes.
  app.use(errorMiddleware);

  const requestedPort = 0;
  const requestedHost = "127.0.0.1";

  return await new Promise((resolve, reject) => {
    const server = app.listen(requestedPort, requestedHost, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        return reject(new Error("Failed to resolve test server address"));
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: async () =>
          await new Promise<void>((res, rej) =>
            (server as Server).close((err?: Error) => (err ? rej(err) : res())),
          ),
      });
    });

    server.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE" && requestedPort === 0) {
        return reject(
          new Error(
            "Failed to bind e2e test server on an ephemeral port (127.0.0.1:0). " +
              "This usually indicates a restricted runtime/sandbox that blocks socket binds.",
          ),
        );
      }
      reject(err);
    });
  });
}

/**
 * Creates a baseline Express app with JSON, trace middleware, and optional
 * auth context injection for protected route tests.
 */
export function buildApp(opts?: { injectAuth?: boolean }) {
  const app = express();
  app.use(express.json());
  app.use(traceMiddleware);
  
  if (opts?.injectAuth) {
    app.use((req: any, _res, next) => {
      req.auth = { user: { id: "usr_test", email: "test@example.com", name: "Test" } };
      next();
    });
  }

  return app;
}
