/**
 * @fileoverview apps/frontend/src/routes/thread-detail.tsx
 *
 * High-level purpose:
 * Frontend route module that composes page-level UI, data loading, and user flows for navigation states.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates route-scoped layout and state transitions.
 * - Coordinates API interactions with route-specific rendering behavior.
 * - Supports responsive UX patterns for authenticated and guest flows.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Create or update route component exports for target navigation path.
 * 2. Connect route logic to frontend API helpers and shared context providers.
 * 3. Validate route behavior on desktop and mobile with route/e2e tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { useParams, useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";
import { ChatPage } from "./index";

export default function ThreadDetail() {
  const params = useParams();
  const navigate = useNavigate();

  // If no thread id, redirect to home
  createEffect(() => {
    if (!params.id) navigate("/", { replace: true });
  });

  // Render ChatPage, passing threadId as prop (ChatPage will pick up from URL)
  return <ChatPage threadId={params.id} />;
}
