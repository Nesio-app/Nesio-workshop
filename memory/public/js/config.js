/**
 * API base: empty = same origin (Render/VPS/local).
 * GitHub Pages static host must point at the production API.
 */
(function () {
  const host = location.hostname;
  const isGitHubPages = host.endsWith(".github.io");
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";

  let apiBase = "";
  if (isGitHubPages) {
    apiBase = "https://nianguichu.onrender.com";
  } else if (!isLocal) {
    apiBase = "";
  } else {
    apiBase = "";
  }

  window.MEMORIAL_CONFIG = {
    apiBase,
    productionApi: "https://nianguichu.onrender.com",
  };
})();
