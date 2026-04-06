export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  if (typeof window !== "undefined") {
    const { protocol, hostname, port, origin } = window.location;
    const isDev = Boolean(import.meta.env.DEV);
    if (isDev && (port === "5173" || port === "4173")) {
      return `${protocol}//${hostname}:3000`;
    }
    return origin;
  }

  return "http://localhost:3000";
}

export const API_BASE_URL = getApiBaseUrl();
