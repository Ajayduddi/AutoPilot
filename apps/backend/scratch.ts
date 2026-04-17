import { getCachedModelCapabilities } from "./src/services/settings/settings-model-discovery.service";
(async () => {
  try {
    const caps = await getCachedModelCapabilities({
      provider: "minimax",
      baseUrl: "https://api.minimax.chat/v1",
      apiKey: "test"
    });
    console.log("Caps:", caps);
  } catch (err) {
    console.error("Error:", err);
  }
})();
