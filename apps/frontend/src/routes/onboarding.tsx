import { Title } from "@solidjs/meta";
import { useNavigate } from "@solidjs/router";
import { createEffect, createSignal, Show } from "solid-js";
import { useAuth } from "../context/auth.context";

export default function OnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [localError, setLocalError] = createSignal("");

  createEffect(() => {
    const state = auth.state();
    if (!state) return;
    if (state.mode === "authenticated") navigate("/", { replace: true });
    if (state.mode === "login") navigate("/login", { replace: true });
  });

  async function submitOnboarding(e: Event) {
    e.preventDefault();
    setLocalError("");
    if (!email().trim()) return setLocalError("Email is required.");
    if (password().length < 8) return setLocalError("Password must be at least 8 characters.");
    if (password() !== confirmPassword()) return setLocalError("Passwords do not match.");
    setSubmitting(true);
    try {
      await auth.registerOnboarding({
        name: name().trim(),
        email: email().trim(),
        password: password(),
      });
      navigate("/", { replace: true });
    } catch (err: any) {
      setLocalError(err?.message || "Onboarding failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main class="min-h-screen bg-[#0a0a0a] text-neutral-100 flex items-center justify-center px-5">
      <Title>Onboarding — AutoPilot</Title>
      <div class="w-full max-w-[480px] rounded-2xl border border-neutral-800/70 bg-neutral-950/60 p-7 shadow-[0_30px_70px_rgba(0,0,0,0.45)]">
        <h1 class="text-[24px] font-semibold tracking-tight text-white">Create your owner account</h1>
        <p class="text-sm text-neutral-400 mt-1">This app runs in single-user mode. The first account becomes the owner.</p>

        <form class="mt-6 space-y-3.5" onSubmit={submitOnboarding}>
          <input
            type="text"
            value={name()}
            onInput={(ev) => setName(ev.currentTarget.value)}
            placeholder="Name (optional)"
            class="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500/60"
          />
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
            placeholder="Password (min 8 chars)"
            class="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500/60"
          />
          <input
            type="password"
            value={confirmPassword()}
            onInput={(ev) => setConfirmPassword(ev.currentTarget.value)}
            placeholder="Confirm password"
            class="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 text-sm text-neutral-100 outline-none focus:border-indigo-500/60"
          />
          <button
            type="submit"
            disabled={submitting()}
            class={`h-11 w-full rounded-lg border border-indigo-500/40 bg-indigo-500/20 text-indigo-200 text-sm font-medium transition-colors ${submitting() ? "opacity-60 cursor-not-allowed" : "hover:bg-indigo-500/30 hover:text-white"}`}
          >
            {submitting() ? "Creating account..." : "Create account"}
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
