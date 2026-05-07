import { handleCanvasRoute } from "../../server/canvas/canvasRoute.mjs";
import { prepareApiRequestUrl, runWithApiSafety } from "../_shared/routeBridge.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  prepareApiRequestUrl(req, "/api/canvas");

  runWithApiSafety(req, res, () => {
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
