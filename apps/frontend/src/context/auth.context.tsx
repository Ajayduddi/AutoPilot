import { ParentComponent, createContext, createResource, createSignal, useContext } from "solid-js";
import { authApi, type AuthStatePayload } from "../lib/api";

/**
  * auth context value type alias.
  */
type AuthContextValue = {
  state: () => AuthStatePayload | undefined;
  loading: () => boolean;
  refresh: () => Promise<AuthStatePayload | undefined>;
  login: (payload: { email: string; password: string }) => Promise<void>;
  registerOnboarding: (payload: { email: string; name?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  googleStartUrl: () => string;
  authError: () => string;
  setAuthError: (msg: string) => void;
};
const AuthContext = createContext<AuthContextValue>();
export const AuthProvider: ParentComponent = (props) => {
  const [authError, setAuthError] = createSignal("");
  const [state, { refetch }] = createResource(async () => {
    try {
      return await authApi.getState();
    } catch (err) {
      // Transient failures (e.g. during OAuth redirect) should not crash the app.
      // Return login mode so the user sees the login page and can retry.
      console.warn("[auth] session check failed, falling back to login:", err);
      return { mode: "login" as const, oauth: { google: true } } as AuthStatePayload;
    }
  });

  /**
   * Utility function to refresh.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from refresh.
   *
   * @example
   * ```typescript
   * const output = refresh();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function refresh() {
    const r = await refetch();
    return r ?? undefined;
  }

  /**
   * Utility function to login.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param payload - Input value for login.
   * @returns Return value from login.
   *
   * @example
   * ```typescript
   * const output = login(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function login(payload: { email: string; password: string }) {
    setAuthError("");
    await authApi.login(payload);
    await refresh();
  }

  /**
   * Utility function to register onboarding.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param payload - Input value for registerOnboarding.
   * @returns Return value from registerOnboarding.
   *
   * @example
   * ```typescript
   * const output = registerOnboarding(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function registerOnboarding(payload: { email: string; name?: string; password: string }) {
    setAuthError("");
    await authApi.registerOnboarding(payload);
    await refresh();
  }

  /**
   * Utility function to logout.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from logout.
   *
   * @example
   * ```typescript
   * const output = logout();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function logout() {
    setAuthError("");
    await authApi.logout();
    await refresh();
  }

  return (
    <AuthContext.Provider
      value={{
        state: () => state() as AuthStatePayload | undefined,
        loading: () => state.loading,
        refresh,
        login,
        registerOnboarding,
        logout,
        googleStartUrl: () => authApi.googleStartUrl(),
        authError,
        setAuthError,
      }}
    >
      {props.children}
    </AuthContext.Provider>
  );
};

/**
 * Utility function to use auth.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from useAuth.
 *
 * @example
 * ```typescript
 * const output = useAuth();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
