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

  /**
   * Utility function to submit onboarding.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param e - Input value for submitOnboarding.
   * @returns Return value from submitOnboarding.
   *
   * @example
   * ```typescript
   * const output = submitOnboarding(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
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

  function startGoogleAuth() {
    const target = auth.googleStartUrl();
    if (!target) {
      setLocalError("Google sign-in endpoint is unavailable. Please try again.");
      return;
    }
    window.location.assign(target);
  }

  return (
    <main class="min-h-screen bg-[#0a0a0a] text-neutral-100 flex items-center justify-center px-5">
      <Title>Onboarding — AutoPilot</Title>
      <div class="w-full max-w-[440px] rounded-3xl border border-neutral-800/60 bg-[#121212] p-8 sm:p-10 shadow-2xl">
        <div class="mb-8 flex justify-center">
          <div class="w-14 h-14 rounded-3xl bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.15)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </div>
        </div>
        <h1 class="text-[26px] font-semibold tracking-tight text-white text-center">Create account</h1>
        <p class="text-[14px] text-neutral-500 mt-2 text-center">Set up the primary owner account for AutoPilot.</p>

        <form class="mt-8 space-y-4" onSubmit={submitOnboarding}>
          <div class="space-y-1.5">
            <label class="text-[13px] font-medium text-neutral-400 pl-1">Name <span class="text-neutral-600 font-normal">(optional)</span></label>
            <input
              type="text"
              value={name()}
              onInput={(ev) => setName(ev.currentTarget.value)}
              placeholder="e.g. Jane Doe"
              class="h-12 w-full rounded-xl border border-neutral-800 bg-[#1a1a1a] px-4 text-[15px] text-neutral-100 outline-none focus:border-neutral-600 focus:bg-[#1f1f1f] transition-all placeholder:text-neutral-600"
            />
          </div>
          <div class="space-y-1.5 pt-1">
            <label class="text-[13px] font-medium text-neutral-400 pl-1">Email</label>
            <input
              type="email"
              value={email()}
              onInput={(ev) => setEmail(ev.currentTarget.value)}
              placeholder="e.g. you@example.com"
              class="h-12 w-full rounded-xl border border-neutral-800 bg-[#1a1a1a] px-4 text-[15px] text-neutral-100 outline-none focus:border-neutral-600 focus:bg-[#1f1f1f] transition-all placeholder:text-neutral-600"
            />
          </div>
          <div class="grid grid-cols-2 gap-4 pt-1">
            <div class="space-y-1.5">
              <label class="text-[13px] font-medium text-neutral-400 pl-1">Password</label>
              <input
                type="password"
                value={password()}
                onInput={(ev) => setPassword(ev.currentTarget.value)}
                placeholder="Min 8 chars"
                class="h-12 w-full rounded-xl border border-neutral-800 bg-[#1a1a1a] px-4 text-[15px] text-neutral-100 outline-none focus:border-neutral-600 focus:bg-[#1f1f1f] transition-all placeholder:text-neutral-600"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-[13px] font-medium text-neutral-400 pl-1">Confirm</label>
              <input
                type="password"
                value={confirmPassword()}
                onInput={(ev) => setConfirmPassword(ev.currentTarget.value)}
                placeholder="Match password"
                class="h-12 w-full rounded-xl border border-neutral-800 bg-[#1a1a1a] px-4 text-[15px] text-neutral-100 outline-none focus:border-neutral-600 focus:bg-[#1f1f1f] transition-all placeholder:text-neutral-600"
              />
            </div>
          </div>
          <div class="pt-2">
            <button
              type="submit"
              disabled={submitting()}
              class={`h-12 w-full rounded-xl bg-neutral-100 text-black text-[15px] font-medium transition-colors ${submitting() ? "opacity-50 cursor-not-allowed" : "hover:bg-white"}`}
            >
              {submitting() ? "Creating account..." : "Create account"}
            </button>
          </div>
        </form>

        <Show when={auth.state()?.oauth.google}>
          <div class="relative my-7">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-neutral-800/80"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="bg-[#121212] px-3 text-[13px] text-neutral-500">Or continue with</span>
            </div>
          </div>
          <button
            type="button"
            onClick={startGoogleAuth}
            class="h-12 w-full flex items-center justify-center gap-3 rounded-xl border border-neutral-700 bg-[#1a1a1a] text-[15px] text-neutral-200 font-medium hover:text-white hover:bg-[#1f1f1f] hover:border-neutral-600 transition-all"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </button>
        </Show>

        <Show when={localError()}>
          <div class="mt-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
            <p class="text-[13px] text-red-400 font-medium">{localError()}</p>
          </div>
        </Show>
      </div>
    </main>
  );
}
