import { Title } from "@solidjs/meta";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal, Show } from "solid-js";
import { useAuth } from "../context/auth.context";

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [localError, setLocalError] = createSignal("");

  createEffect(() => {
    const state = auth.state();
    if (!state) return;
    if (state.mode === "authenticated") navigate("/", { replace: true });
    if (state.mode === "onboarding") navigate("/onboarding", { replace: true });
  });

  createEffect(() => {
    const e = search.error;
    if (!e) return;
    if (e === "single_user_locked") setLocalError("This app is locked to the first onboarded account.");
    else if (e === "google_auth_failed") setLocalError("Google authentication failed. Please try again.");
    else if (e === "invalid_oauth_state") setLocalError("OAuth session expired. Please retry Google login.");
  });

  async function submitLogin(e: Event) {
    e.preventDefault();
    setLocalError("");
    if (!email().trim() || !password()) {
      setLocalError("Email and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await auth.login({ email: email().trim(), password: password() });
      navigate("/", { replace: true });
    } catch (err: any) {
      setLocalError(err?.message || "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main class="min-h-screen bg-[#0a0a0a] text-neutral-100 flex items-center justify-center px-5">
      <Title>Login — AutoPilot</Title>
      <div class="w-full max-w-[440px] rounded-2xl border border-neutral-800/70 bg-neutral-950/60 p-7 shadow-[0_30px_70px_rgba(0,0,0,0.45)]">
        <h1 class="text-[24px] font-semibold tracking-tight text-white">Welcome back</h1>
        <p class="text-sm text-neutral-400 mt-1">Sign in to continue using AutoPilot.</p>

        <form class="mt-6 space-y-3.5" onSubmit={submitLogin}>
          <input
            type="email"
            value={email()}
            onInput={(ev) => setEmail(ev.currentTarget.value)}
            placeholder="Email"
            class="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500/60"
          />
          <input
            type="password"
            value={password()}
            onInput={(ev) => setPassword(ev.currentTarget.value)}
            placeholder="Password"
            class="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500/60"
          />
          <button
            type="submit"
            disabled={submitting()}
            class={`h-11 w-full rounded-lg border border-indigo-500/40 bg-indigo-500/20 text-indigo-200 text-sm font-medium transition-colors ${submitting() ? "opacity-60 cursor-not-allowed" : "hover:bg-indigo-500/30 hover:text-white"}`}
          >
            {submitting() ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <Show when={auth.state()?.oauth.google}>
          <div class="my-4 h-px bg-neutral-800" />
          <a
            href={auth.googleStartUrl()}
            class="h-11 w-full inline-flex items-center justify-center rounded-lg border border-neutral-700 text-sm text-neutral-200 hover:text-white hover:bg-neutral-800/80 transition-colors"
          >
            Continue with Google
          </a>
        </Show>

        <Show when={localError()}>
          <p class="mt-4 text-sm text-red-300">{localError()}</p>
        </Show>
      </div>
    </main>
  );
}
