import { CanvaOAuthClient } from "./canva-oauth.js";
import { ConfigError, loadConfig, publicStartUrl } from "./config.js";
import { createLogger } from "./logger.js";
import { PendingAuthStore } from "./pending-auth.js";
import { createApp, SERVICE_NAME, SERVICE_VERSION } from "./server.js";
import { TokenManager } from "./token-manager.js";
import { TokenStore } from "./token-store.js";

const log = createLogger(SERVICE_NAME);

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log("error", "config.invalid", { message: err.message });
      process.exit(1);
    }
    throw err;
  }

  const tokenStore = new TokenStore(config.tokenStorePath);
  const oauthClient = new CanvaOAuthClient(config);
  const tokenManager = new TokenManager(tokenStore, oauthClient, { refreshSkewSeconds: config.refreshSkewSeconds, log });
  const pendingAuth = new PendingAuthStore();

  const server = createApp({ config, oauthClient, tokenManager, tokenStore, pendingAuth, log });

  server.listen(config.port, config.host, () => {
    log("info", "server.started", {
      version: SERVICE_VERSION,
      listen: `${config.host}:${config.port}`,
      redirect_uri: config.redirectUri,
      authorize_url: publicStartUrl(config),
      store_path: config.tokenStorePath,
      scopes: config.scopes,
      access_protected: Boolean(config.apiKey),
    });
  });

  const shutdown = (signal: string): void => {
    log("info", "server.stopping", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
