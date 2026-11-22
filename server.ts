import http from "http";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  assertSafeRuntimeEnvironment,
  attachRequestId,
  corsAndSecurityHeaders,
  isDemoModeAllowed,
} from "./server/authService";
import { marketEngine } from "./server/marketEngine";
import { matchingEngine } from "./server/matchingEngine";
import { createApiRouter } from "./server/routes";
import { sessionRepository } from "./server/sessionRepository";
import { STORE_FILE } from "./server/store";
import { SecureWsGateway } from "./server/wsGateway";

async function startServer() {
  // Mandatory startup check: refuse boot if DEV_DEMO_MODE=true in production
  assertSafeRuntimeEnvironment();

  const app = express();
  app.set("trust proxy", 2);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(attachRequestId);
  app.use(corsAndSecurityHeaders);
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));

  const server = http.createServer(app);
  const wsGateway = new SecureWsGateway(server);

  // Wire Market Engine -> Matching Engine -> Scoped Authenticated WebSocket Gateway
  marketEngine.onTick((quotes) => {
    const matchResult = matchingEngine.onMarketTick(quotes);
    wsGateway.broadcastMarketTick(quotes, matchResult);
  });

  marketEngine.start();

  // Periodic cleanup of expired persisted sessions
  setInterval(() => {
    sessionRepository.purgeExpired();
  }, 60 * 60 * 1000);

  const apiRouter = createApiRouter(() => wsGateway.getAuthenticatedCount());
  app.use("/api/v1", apiRouter);
  app.use("/api", apiRouter);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server, path: "/__vite_hmr" },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(["/server.cjs", "/server.cjs.map"], (_req, res) => res.status(404).end());
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[汇通财经] Server & SecureWS running on http://localhost:${PORT} (NODE_ENV=${process.env.NODE_ENV || "development"}, DEV_DEMO_MODE=${isDemoModeAllowed()})`
    );
  });
}

startServer();
