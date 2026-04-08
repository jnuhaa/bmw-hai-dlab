import type { BoardAsset, WorkflowType } from "../types/assets";

type SourceAssetPanelProps = {
  selectedAsset: BoardAsset | null;
  childAssets: BoardAsset[];
  workflowType: WorkflowType;
  canOpenCrop: boolean;
  generationJobId: string | null;
  errorMessage: string | null;
  onWorkflowTypeChange: (workflowType: WorkflowType) => void;
  onExtract: () => void;
  onOpenCrop: () => void;
};

const workflowTypeOptions: WorkflowType[] = ["shape", "texture", "pattern"];

function getStatusCopy(asset: BoardAsset | null) {
  if (!asset) {
    return "idle";
  }

  return asset.generationStatus;
}

export function SourceAssetPanel({
  selectedAsset,
  childAssets,
  workflowType,
  canOpenCrop,
  generationJobId,
  errorMessage,
  onWorkflowTypeChange,
  onExtract,
  onOpenCrop,
}: SourceAssetPanelProps) {
  const status = getStatusCopy(selectedAsset);
  const isGenerating = status === "queued" || status === "running";
  const canExtract = Boolean(selectedAsset?.imageUrl) && !isGenerating;

  return (
    <section className="source-link-panel">
      <header className="source-link-panel__header">
        <div>
          <p className="section-label">Selected image</p>
          <h2>Diverge generation</h2>
        </div>
        {selectedAsset ? (
          <span className={`source-link-panel__status source-link-panel__status--${status}`}>
            {status}
          </span>
        ) : null}
      </header>

      {!selectedAsset ? (
        <div className="source-link-panel__empty">
          <p>Select any image in Diverge.</p>
          <span>
            The selected image becomes the parent for linked generated derivatives.
          </span>
        </div>
      ) : (
        <>
          <div className="source-link-panel__source">
            <img
              src={selectedAsset.imageUrl}
              alt={selectedAsset.title}
              className="source-link-panel__source-image"
            />
            <div className="source-link-panel__source-meta">
              <strong>{selectedAsset.title}</strong>
              <span>{selectedAsset.labels.join(" • ")}</span>
              <small>{selectedAsset.kind}</small>
              {generationJobId ? (
                <small>job {generationJobId}</small>
              ) : (
                <small>ready for generation</small>
              )}
            </div>
          </div>

          <div className="source-link-panel__controls">
            <label className="source-link-panel__workflow">
              <span className="section-label">Workflow type</span>
              <select
                value={workflowType}
                onChange={(event) => onWorkflowTypeChange(event.target.value as WorkflowType)}
              >
                {workflowTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <div className="source-link-panel__actions">
              <button
                type="button"
                className="dock-button dock-button--ghost"
                onClick={onOpenCrop}
                disabled={!canOpenCrop}
              >
                Crop source
              </button>
              <button
                type="button"
                className="dock-button dock-button--primary"
                disabled={!canExtract}
                onClick={onExtract}
              >
                {isGenerating ? "Generating..." : "Extract with AI"}
              </button>
            </div>
          </div>

          {errorMessage ? (
            <p className="source-link-panel__error">{errorMessage}</p>
          ) : null}

          <div className="source-link-panel__children">
            <p className="section-label">Linked generated outputs</p>
            {childAssets.length === 0 ? (
              <span className="source-link-panel__children-empty">
                No generated children yet for this source.
              </span>
            ) : (
              <div className="source-link-panel__children-grid">
                {childAssets.map((asset) => (
                  <article key={asset.id} className="source-link-panel__child">
                    <img src={asset.imageUrl} alt={asset.title} />
                    <div>
                      <strong>{asset.title}</strong>
                      <span>Linked to {selectedAsset.title}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
