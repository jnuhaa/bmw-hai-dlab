import type { ClusterId, ClusterZone } from "../../lib/mockClusters";

type SphereZoneOverlayProps = {
  zone: ClusterZone;
  isSelected: boolean;
  onSelect?: (clusterId: ClusterId) => void;
};

export function SphereZoneOverlay({
  zone,
  isSelected,
  onSelect,
}: SphereZoneOverlayProps) {
  return (
    <button
      className={`sphere-zone sphere-zone--${zone.id} sphere-zone--${zone.accent} ${
        isSelected ? "sphere-zone--selected" : ""
      }`}
      type="button"
      style={{
        left: `${zone.labelX}%`,
        top: `${zone.labelY}%`,
      }}
      onClick={() => onSelect?.(zone.id)}
    >
      <span className="sphere-zone__ring" style={{ inset: `${zone.ringInset}%` }} />
      <span className="sphere-zone__content">
        <strong>{zone.title}</strong>
        <small>{zone.subtitle}</small>
      </span>
    </button>
  );
}
