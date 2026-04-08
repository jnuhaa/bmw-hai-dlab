import type { ExtractionJobResponse } from "../types/extraction";

type ExtractionResultsPanelProps = {
  response: ExtractionJobResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
};

export function ExtractionResultsPanel({
  response,
  isLoading,
  errorMessage,
}: ExtractionResultsPanelProps) {
  const isVisible = Boolean(response || isLoading || errorMessage);

  return (
    <section className={`results-tray ${isVisible ? "results-tray--visible" : ""}`}>
      <div className="results-tray__header">
        <div>
          <p className="section-label">Translated outputs</p>
          <h2>Extracted visual ingredient boards</h2>
        </div>
        {response ? (
          <div className="results-tray__meta">
            <span className="studio-pill">{response.provider}</span>
            <span className="studio-status-copy">{response.workflowType}</span>
            {response.fallbackReason ? (
              <span className="studio-status-copy studio-status-copy--warning">
                fallback: {response.fallbackReason}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="results-tray__empty">
          <p>Preparing extracted boards...</p>
          <span>The selected sphere zone is being translated into reusable visual material.</span>
        </div>
      ) : null}

      {!isLoading && errorMessage ? (
        <div className="results-tray__empty">
          <p>Extraction could not complete.</p>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {!isLoading && !errorMessage && !response ? (
        <div className="results-tray__empty">
          <p>No extracted boards yet.</p>
          <span>Cluster the field, select a zone, and extract when you want translated outputs.</span>
        </div>
      ) : null}

      {response ? (
        <div className="results-tray__rail">
          {response.generatedOutputs.map((result) => (
            <article key={result.id} className="result-tile">
              <img className="result-tile__image" src={result.imageUrl} alt={result.title} />
              <div className="result-tile__body">
                <p className="section-label">{result.caption}</p>
                <h3>{result.title}</h3>
                <div className="result-tile__chips">
                  {result.tags.map((tag) => (
                    <span key={`${result.id}-${tag}`} className="sphere-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
