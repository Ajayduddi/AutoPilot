import { ParentComponent, createContext, createResource, createSignal, useContext } from "solid-js";
import { authApi, type AuthStatePayload } from "../lib/api";

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
  const [state, { refetch }] = createResource(() => authApi.getState());

  async function refresh() {
    const r = await refetch();
    return r ?? undefined;
  }

  async function login(payload: { email: string; password: string }) {
    setAuthError("");
    await authApi.login(payload);
    await refresh();
  }

  async function registerOnboarding(payload: { email: string; name?: string; password: string }) {
    setAuthError("");
    await authApi.registerOnboarding(payload);
    await refresh();
  }

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

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
