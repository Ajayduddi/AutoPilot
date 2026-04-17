/**
 * @fileoverview apps/frontend/src/app.tsx
 *
 * High-level purpose:
 * Frontend module supporting application runtime behavior, user experience, or development workflow reliability.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Defines typed module contracts for predictable frontend behavior.
 * - Improves maintainability through explicit module responsibilities.
 * - Supports integration with routes, components, and shared utilities.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import and compose this module through frontend boundaries.
 * 2. Wire module outputs to consumers with typed interfaces.
 * 3. Validate behavior through corresponding frontend tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { MetaProvider, Title, Meta, Link } from "@solidjs/meta";
import { Router, Route, useLocation, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Show, Suspense, createEffect, lazy } from "solid-js";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
// Auth routes are eager-loaded (first screen users see)
import LoginPage from "./routes/login";
import OnboardingPage from "./routes/onboarding";
// All app routes are lazy-loaded for bundle splitting
const Home = lazy(() => import("./routes/index"));
const ThreadPage = lazy(() => import("./routes/thread-detail"));
const Workflows = lazy(() => import("./routes/workflows"));
const WorkflowDetail = lazy(() => import("./routes/workflow-detail"));
const Notifications = lazy(() => import("./routes/notifications"));
const Approvals = lazy(() => import("./routes/approvals"));
const Settings = lazy(() => import("./routes/settings"));
import { NotificationsProvider } from "./context/notifications.context";
import { AuthProvider, useAuth } from "./context/auth.context";
import { MobileMenuProvider } from "./context/mobile-menu.context";
import "./app.css";

function RouteLoadingFallback() {
  return (
    <div class="flex-1 flex items-center justify-center h-full">
      <div class="flex flex-col items-center gap-3">
        <div class="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        <p class="text-sm text-neutral-500">Loading…</p>
      </div>
    </div>
  );
}

function GlobalErrorFallback(err: Error) {
  // Sanitize error messages: strip potential backend internals
  const safeMessage = (() => {
    const raw = err.message || "";
    // Hide stack traces, file paths, and overly technical messages
    if (/\bat\s+\S+\s*\(/.test(raw) || raw.includes("/") && raw.includes(":") && raw.length > 200) {
      return "An unexpected error occurred.";
    }
    return raw.length > 200 ? raw.slice(0, 200) + "…" : raw || "An unexpected error occurred.";
  })();
  return (
    <div class="flex-1 flex flex-col items-center justify-center h-screen gap-4 text-center px-6">
      <div class="text-4xl" aria-hidden="true">⚠️</div>
      <h1 class="text-xl font-semibold text-red-400">Something went wrong</h1>
      <p class="text-neutral-400 text-sm max-w-sm">{safeMessage}</p>
      <button
        class="mt-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        onClick={() => window.location.reload()}
      >
        Reload App
      </button>
    </div>
  );
}

function RootShell(props: { children: any }) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const isAuthRoute = () => location.pathname === "/login" || location.pathname === "/onboarding";

  createEffect(() => {
    const state = auth.state();
    if (!state) return;
    const mfaPending = Boolean(state.pendingMfaUser);

    if (isAuthRoute()) {
      if (state.mode === "authenticated" && !mfaPending) navigate("/", { replace: true });
      if (location.pathname === "/login" && state.mode === "onboarding") navigate("/onboarding", { replace: true });
      if (location.pathname === "/onboarding" && state.mode === "login") navigate("/login", { replace: true });
      return;
    }

    if (state.mode === "onboarding") navigate("/onboarding", { replace: true });
    if (state.mode === "login" || mfaPending) navigate("/login", { replace: true });
  });

  return (
    <Show
      when={!isAuthRoute()}
      fallback={<main class="min-h-screen bg-[#0a0a0a] text-neutral-100">{props.children}</main>}
    >
      <Show
        when={!auth.loading()}
        fallback={
          <main class="min-h-screen bg-[#0a0a0a] text-neutral-100 flex items-center justify-center">
            <p class="text-sm text-neutral-400">Checking session...</p>
          </main>
        }
      >
      <NotificationsProvider>
        <MobileMenuProvider>
          <AppLayout>
            <Sidebar />
            <ErrorBoundary fallback={(err) => GlobalErrorFallback(err)}>
              <Suspense fallback={<RouteLoadingFallback />}>
                {props.children}
              </Suspense>
            </ErrorBoundary>
          </AppLayout>
        </MobileMenuProvider>
      </NotificationsProvider>
      </Show>
    </Show>
  );
}

/**
 * Builds the Content-Security-Policy string.
 * In dev mode, includes the API dev server origin and WebSocket for HMR.
 * In production, locks everything to 'self'.
 */
function buildCspContent(): string {
  const isDev = import.meta.env.DEV;
  // In dev, the frontend is on :5173 but the API runs on :3000 — different origin.
  // Also, Vite HMR needs ws: connections.
  const connectSrc = isDev
    ? "'self' http://localhost:3000 ws://localhost:5173 ws://localhost:4173"
    : "'self'";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src ${connectSrc}`,
    "img-src 'self' data: blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ") + ";";
}

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>AutoPilot</Title>
          <Meta name="description" content="Trigger and manage your n8n automations through a unified chat interface." />
          <Meta name="theme-color" content="#6366f1" />
          <Meta name="referrer" content="strict-origin-when-cross-origin" />
          <Meta http-equiv="content-security-policy" content={buildCspContent()} />
          <Meta name="mobile-web-app-capable" content="yes" />
          <Meta name="apple-mobile-web-app-capable" content="yes" />
          <Meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <Meta name="apple-mobile-web-app-title" content="AutoPilot" />
          <Link rel="icon" type="image/svg+xml" href="/icons/icon-512.svg" />
          <Link rel="apple-touch-icon" href="/icons/icon-512.svg" />
          <Link rel="manifest" href="/manifest.json" />
          {/* Inter web font — all weight variants for consistent bold rendering across devices */}
          <Link rel="preconnect" href="https://fonts.googleapis.com" />
          <Link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
          <Link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />

          <AuthProvider>
            <RootShell>{props.children}</RootShell>
          </AuthProvider>
        </MetaProvider>
      )}
    >
      <Route path="/login" component={LoginPage} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/" component={Home} />
      <Route path="/workflows" component={Workflows} />
      <Route path="/workflows/:id" component={WorkflowDetail} />
      <Route path="/threads/:id" component={ThreadPage} />
      <Route path="/notifications" component={Notifications} />
      <Route path="/approvals" component={Approvals} />
      <Route path="/settings" component={Settings} />
    </Router>
  );
}
