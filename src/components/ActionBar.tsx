type ActionBarProps = {
  isClustered: boolean;
  canExtract: boolean;
  isExtracting: boolean;
  selectedClusterTitle: string | null;
  selectedClusterAssetCount: number;
  onToggleCluster: () => void;
  onExtract: () => void;
};

export function ActionBar({
  isClustered,
  canExtract,
  isExtracting,
  selectedClusterTitle,
  selectedClusterAssetCount,
  onToggleCluster,
  onExtract,
}: ActionBarProps) {
  return (
    <section className="control-dock">
      <div className="control-dock__header">
        <p className="section-label">Actions</p>
        <h2>Organize and translate</h2>
      </div>
      <div className="control-dock__stack">
        <button
          className="dock-button dock-button--primary"
          type="button"
          onClick={onToggleCluster}
        >
          <span className="dock-button__state">
            {isClustered ? "Sphere zones active" : "Reorganize the orb"}
          </span>
          <strong>{isClustered ? "Reset layout" : "Cluster"}</strong>
          <span>
            {isClustered
              ? "Return the sphere to its free-distribution field."
              : "Slide embedded inspiration shards into readable semantic bands."}
          </span>
        </button>
        <button
          className="dock-button"
          type="button"
          onClick={onExtract}
          disabled={!canExtract || isExtracting}
        >
          <span className="dock-button__state">
            {isExtracting
              ? "Extraction in progress"
              : selectedClusterTitle
                ? `${selectedClusterTitle} · ${selectedClusterAssetCount} assets`
                : "Select a cluster to extract"}
          </span>
          <strong>Extract</strong>
          <span>
            {isExtracting
              ? "Stabilizing the field and requesting translated ingredient boards."
              : "Send the selected semantic zone and context prompt through the backend extraction path."}
          </span>
        </button>
      </div>
    </section>
  );
}
