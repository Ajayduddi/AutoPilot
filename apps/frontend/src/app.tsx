import { MetaProvider, Title, Meta, Link } from "@solidjs/meta";
import { Router, Route } from "@solidjs/router";
import { ErrorBoundary } from "solid-js";
import { AppLayout } from "./components/layout/AppLayout";
import { Sidebar } from "./components/layout/Sidebar";
import Home from "./routes/index";
import ThreadPage from "./routes/thread-detail";
import Workflows from "./routes/workflows";
import WorkflowDetail from "./routes/workflow-detail";
import Notifications from "./routes/notifications";
import Approvals from "./routes/approvals";
import Settings from "./routes/settings";
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

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          {/* Global Meta */}
          <Title>AutoPilot – Chat Automation Platform</Title>
          <Meta name="description" content="Trigger and manage your n8n automations through a unified chat interface." />
          <Meta name="theme-color" content="#6366f1" />
          <Meta name="mobile-web-app-capable" content="yes" />
          <Meta name="apple-mobile-web-app-capable" content="yes" />
          <Meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
          <Meta name="apple-mobile-web-app-title" content="AutoPilot" />
          <Link rel="manifest" href="/manifest.json" />

          <AppLayout>
            <Sidebar />
            <ErrorBoundary fallback={(err) => GlobalErrorFallback(err)}>
              {props.children}
            </ErrorBoundary>
          </AppLayout>
        </MetaProvider>
      )}
    >
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
