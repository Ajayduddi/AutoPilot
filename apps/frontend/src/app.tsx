import { MetaProvider, Title, Meta, Link } from "@solidjs/meta";
import { Router, Route, useLocation, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Show, createEffect } from "solid-js";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
import Home from "./routes/index";
import ThreadPage from "./routes/thread-detail";
import Workflows from "./routes/workflows";
import WorkflowDetail from "./routes/workflow-detail";
import Notifications from "./routes/notifications";
import Approvals from "./routes/approvals";
import Settings from "./routes/settings";
import LoginPage from "./routes/login";
import OnboardingPage from "./routes/onboarding";
import { NotificationsProvider } from "./context/notifications.context";
import { AuthProvider, useAuth } from "./context/auth.context";
import "./app.css";

function GlobalErrorFallback(err: Error) {
  return (
    <div class="flex-1 flex flex-col items-center justify-center h-screen gap-4 text-center px-6">
      <div class="text-4xl">⚠️</div>
      <h1 class="text-xl font-semibold text-red-400">Something went wrong</h1>
      <p class="text-neutral-400 text-sm max-w-sm">{err.message || "An unexpected error occurred."}</p>
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

    if (isAuthRoute()) {
      if (state.mode === "authenticated") navigate("/", { replace: true });
      if (location.pathname === "/login" && state.mode === "onboarding") navigate("/onboarding", { replace: true });
      if (location.pathname === "/onboarding" && state.mode === "login") navigate("/login", { replace: true });
      return;
    }

    if (state.mode === "onboarding") navigate("/onboarding", { replace: true });
    if (state.mode === "login") navigate("/login", { replace: true });
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
        <AppLayout>
          <Sidebar />
          <ErrorBoundary fallback={(err) => GlobalErrorFallback(err)}>
            {props.children}
          </ErrorBoundary>
        </AppLayout>
      </NotificationsProvider>
      </Show>
    </Show>
  );
}

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>AutoPilot</Title>
          <Meta name="description" content="Trigger and manage your n8n automations through a unified chat interface." />
          <Meta name="theme-color" content="#6366f1" />
          <Meta name="mobile-web-app-capable" content="yes" />
          <Meta name="apple-mobile-web-app-capable" content="yes" />
          <Meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <Meta name="apple-mobile-web-app-title" content="AutoPilot" />
          <Link rel="icon" type="image/svg+xml" href="/icons/icon-512.svg" />
          <Link rel="apple-touch-icon" href="/icons/icon-512.svg" />
          <Link rel="manifest" href="/manifest.json" />

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
