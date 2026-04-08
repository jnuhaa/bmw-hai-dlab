import { handleExtractRoute } from "./extraction/extractRoute.mjs";
import { handleLiveCaptureRoute } from "./liveCapture/liveCaptureRoute.mjs";
import { handleCanvasRoute } from "./canvas/canvasRoute.mjs";
import { checkApiKey, checkRateLimit, logApiRequest } from "./shared/apiSafety.mjs";

function sendJson(res, statusCode, payload, headers = {}) {
  res.statusCode = statusCode;
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function withApiSafety(routeHandler) {
  return (req, res, next) => {
    const startedAtMs = Date.now();
    const finishLogger = () => logApiRequest(req, res.statusCode || 200, startedAtMs);
    res.once("finish", finishLogger);

    const keyCheck = checkApiKey(req);
    if (!keyCheck.ok) {
      sendJson(res, keyCheck.statusCode, keyCheck.payload);
      return;
    }

    const rateCheck = checkRateLimit(req);
    if (!rateCheck.ok) {
      sendJson(res, rateCheck.statusCode, rateCheck.payload, rateCheck.headers ?? {});
      return;
    }

    routeHandler(req, res, next);
  };
}

function attachExtractMiddleware(server) {
  server.middlewares.use("/api/extract", withApiSafety((req, res) => {
    handleExtractRoute(req, res);
  }));

  server.middlewares.use("/api/live-capture", withApiSafety((req, res, next) => {
    handleLiveCaptureRoute(req, res).catch((error) => {
      console.error("[live-capture] Route failure", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Live capture failed." }));
      next();
    });
  }));

  server.middlewares.use("/api/canvas", withApiSafety((req, res) => {
    handleCanvasRoute(req, res).catch((error) => {
      console.error("[canvas] Route failure", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Canvas route failed." }));
      }
    });
  }));
}

export function createExtractRoutePlugin() {
  return {
    name: "local-extract-route",
    configureServer(server) {
      attachExtractMiddleware(server);
    },
    configurePreviewServer(server) {
      attachExtractMiddleware(server);
    },
  };
}
