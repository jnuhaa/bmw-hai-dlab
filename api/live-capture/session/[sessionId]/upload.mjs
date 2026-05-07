import { handleLiveCaptureRoute } from "../../../../server/liveCapture/liveCaptureRoute.mjs";
import { prepareApiRequestUrl, runWithApiSafety } from "../../../_shared/routeBridge.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  prepareApiRequestUrl(req, "/api/live-capture");

  runWithApiSafety(req, res, () => {
    handleLiveCaptureRoute(req, res).catch((error) => {
      console.error("[live-capture] Route failure", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Live capture route failed." }));
      }
    });
  });
}
