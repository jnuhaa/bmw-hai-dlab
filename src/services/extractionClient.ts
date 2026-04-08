import type { ExtractRequest, ExtractionJobResponse } from "../types/extraction";

export async function requestExtraction(payload: ExtractRequest) {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Extraction request failed (HTTP ${response.status}).`);
  }

  return (await response.json()) as ExtractionJobResponse;
}

export async function getExtractionJob(generationJobId: string) {
  const response = await fetch(`/api/extract/${generationJobId}`);

  if (!response.ok) {
    const hint =
      response.status === 404
        ? "Job not found (server may have restarted, or polling URL mismatch)."
        : `HTTP ${response.status}`;
    throw new Error(`Unable to read extraction job status: ${hint}`);
  }

  return (await response.json()) as ExtractionJobResponse;
}
