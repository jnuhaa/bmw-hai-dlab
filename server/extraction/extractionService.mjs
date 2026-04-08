import { extractWithComfyUiProvider } from "./comfyUiExtractionService.mjs";
import { extractWithMockProvider } from "./mockExtractionService.mjs";

function isTrue(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function extractDesignIngredients(payload) {
  const provider = (process.env.EXTRACTION_PROVIDER ?? "mock").trim().toLowerCase();
  const allowMockFallback = isTrue(process.env.COMFYUI_ALLOW_MOCK_FALLBACK);

  if (provider === "comfyui") {
    try {
      console.info("[extract] Running ComfyUI extraction", {
        sourceAssetId: payload.sourceAssetId,
        workflowType: payload.workflowType ?? "shape",
      });
      return await extractWithComfyUiProvider(payload);
    } catch (error) {
      const fallbackReason =
        error instanceof Error ? error.message : "ComfyUI extraction unavailable";

      if (!allowMockFallback) {
        throw new Error(`ComfyUI extraction failed: ${fallbackReason}`);
      }

      console.warn(
        "[extract] ComfyUI provider unavailable, falling back to mock provider.",
        error,
      );

      return extractWithMockProvider(payload, {
        fallbackReason,
      });
    }
  }

  if (provider !== "mock") {
    const fallbackReason = `Unknown EXTRACTION_PROVIDER="${provider}" in running server process.`;
    console.warn(`[extract] ${fallbackReason} Falling back to mock provider.`);
    console.info("[extract] Running mock extraction", {
      sourceAssetId: payload.sourceAssetId,
      workflowType: payload.workflowType ?? "shape",
    });
    return extractWithMockProvider(payload, {
      fallbackReason,
    });
  }

  console.info("[extract] Running mock extraction", {
    sourceAssetId: payload.sourceAssetId,
    workflowType: payload.workflowType ?? "shape",
  });
  return extractWithMockProvider(payload, {
    fallbackReason:
      'EXTRACTION_PROVIDER is "mock" in the running server process environment.',
  });
}
