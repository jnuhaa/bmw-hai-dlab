import { handleExtractRoute } from "./extraction/extractRoute.mjs";
import { handleLiveCaptureRoute } from "./liveCapture/liveCaptureRoute.mjs";
import { handleCanvasRoute } from "./canvas/canvasRoute.mjs";

function attachExtractMiddleware(server) {
  server.middlewares.use("/api/extract", (req, res) => {
    handleExtractRoute(req, res);
  });

  server.middlewares.use("/api/live-capture", (req, res, next) => {
    handleLiveCaptureRoute(req, res).catch((error) => {
      console.error("[live-capture] Route failure", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Live capture failed." }));
      next();
    });
  });

  server.middlewares.use("/api/canvas", (req, res) => {
    handleCanvasRoute(req, res).catch((error) => {
      console.error("[canvas] Route failure", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Canvas route failed." }));
      }
    });
  });
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
