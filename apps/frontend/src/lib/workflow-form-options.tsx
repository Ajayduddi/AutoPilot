import type { SelectOption } from "../components/ui/CustomSelect";
const Icon = (d: string) => () => (
  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d={d} />
  </svg>
);
const IconMulti = (paths: string[]) => () => (
  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    {paths.map((d) => <path d={d} />)}
  </svg>
);
export const providerLabels: Record<string, string> = {
  n8n: "n8n",
  zapier: "Zapier",
  make: "Make.com",
  sim: "Sim",
  custom: "Custom",
};
export const providerOptions: SelectOption[] = [
  { value: "n8n", label: "n8n", icon: IconMulti(["M4 6h16", "M4 12h16", "M4 18h8"]) },
  { value: "zapier", label: "Zapier", icon: Icon("M13 2L3 14h9l-1 8 10-12h-9l1-8") },
  { value: "make", label: "Make.com", icon: IconMulti(["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M2 12h20", "M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10", "M12 2a15 15 0 0 0-4 10 15 15 0 0 0 4 10"]) },
  { value: "sim", label: "Sim", icon: IconMulti(["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18", "M15 3v18", "M3 9h18", "M3 15h18"]) },
  { value: "custom", label: "Custom", icon: IconMulti(["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"]) },
];
export const visibilityOptions: SelectOption[] = [
  { value: "public", label: "Public", icon: IconMulti(["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M2 12h20", "M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10", "M12 2a15 15 0 0 0-4 10 15 15 0 0 0 4 10"]) },
  { value: "private", label: "Private", icon: IconMulti(["M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z", "M7 11V7a5 5 0 0 1 10 0v4"]) },
];
export const authTypeOptions: SelectOption[] = [
  { value: "none", label: "No Auth", icon: IconMulti(["M18 6 6 18", "M6 6l12 12"]) },
  { value: "bearer", label: "Bearer Token", icon: IconMulti(["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78m0 0L12 8l4-1 1 4-3.39 3.61z"]) },
  { value: "api_key", label: "API Key", icon: IconMulti(["M15.5 7.5l2 2", "M19 4l-6.5 6.5", "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78m0 0L12 8l4-1 1 4-3.39 3.61z"]) },
  { value: "header_secret", label: "Header Secret", icon: IconMulti(["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"]) },
  { value: "custom", label: "Custom", icon: IconMulti(["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73v.18a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"]) },
];
export const triggerMethodOptions: SelectOption[] = [
  { value: "webhook", label: "webhook", icon: IconMulti(["M4 12h10", "M10 6l6 6-6 6"]) },
  { value: "api", label: "api", icon: IconMulti(["M8 9l-3 3 3 3", "M16 9l3 3-3 3", "M13 6l-2 12"]) },
  { value: "internal", label: "internal", icon: IconMulti(["M12 2v20", "M2 12h20"]) },
];
export const httpMethodOptions: SelectOption[] = [
  { value: "GET", label: "GET", icon: Icon("M5 12h14") },
  { value: "POST", label: "POST", icon: IconMulti(["M5 12h14", "M12 5l7 7-7 7"]) },
  { value: "PUT", label: "PUT", icon: IconMulti(["M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"]) },
  { value: "PATCH", label: "PATCH", icon: IconMulti(["M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z", "M15 5l4 4"]) },
  { value: "DELETE", label: "DELETE", icon: IconMulti(["M3 6h18", "M8 6V4h8v2", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"]) },
];
export const providerFilterOptions = [
  { value: "", label: "All Providers" },
  { value: "n8n", label: "n8n" },
  { value: "zapier", label: "Zapier" },
  { value: "make", label: "Make.com" },
  { value: "sim", label: "Sim" },
  { value: "custom", label: "Custom" },
];