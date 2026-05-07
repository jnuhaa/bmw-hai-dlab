import { handleExtractRoute } from "../../server/extraction/extractRoute.mjs";
import { prepareApiRequestUrl, runWithApiSafety } from "../_shared/routeBridge.mjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  prepareApiRequestUrl(req, "/api/extract");

  runWithApiSafety(req, res, () => {
    handleExtractRoute(req, res).catch((error) => {
      console.error("[extract] Route failure", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Extraction failed." }));
      }
    });
  });
}
