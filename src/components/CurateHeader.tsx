type CurateHeaderProps = {
  assetCount: number;
  captureCount: number;
  isClustered: boolean;
};

export function CurateHeader({
  assetCount,
  captureCount,
  isClustered,
}: CurateHeaderProps) {
  return (
    <header className="studio-header">
      <div>
        <p className="studio-header__eyebrow">BMW AI Design Workflow</p>
        <h1 className="studio-header__title">Designer-led inspiration field</h1>
      </div>
      <div className="studio-header__status">
        <span className="studio-pill">{isClustered ? "Cluster view" : "Live field"}</span>
        <span className="studio-status-copy">
          {captureCount.toString().padStart(2, "0")} captures · {assetCount.toString().padStart(2, "0")} assets
        </span>
      </div>
    </header>
  );
}
