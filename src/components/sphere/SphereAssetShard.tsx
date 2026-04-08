import type { ClusterId } from "../../lib/mockClusters";
import type { BoardAsset } from "../../types/assets";
import {
  getShardDimensions,
  getSphereProjection,
} from "./sphereProjection";

type SphereAssetShardProps = {
  asset: BoardAsset;
  clusterId?: ClusterId;
  isActive?: boolean;
  isMuted?: boolean;
  onSelect?: (asset: BoardAsset) => void;
  pointerDrift: { x: number; y: number };
};

export function SphereAssetShard({
  asset,
  clusterId,
  isActive = false,
  isMuted = false,
  onSelect,
  pointerDrift,
}: SphereAssetShardProps) {
  const dimensions = getShardDimensions(asset);
  const projection = getSphereProjection(asset, { pointerDrift, isActive });
  const {
    x,
    y,
    scale,
    rotation,
    tiltX,
    tiltY,
    driftX,
    driftY,
    frontness,
    blur,
    hemisphere,
    shadowDepth,
  } = projection;
  const opacity = isMuted ? projection.opacity * 0.62 : projection.opacity;
  const zIndex = Math.round(frontness * 100 + (isActive ? 240 : 0));
  const isInteractive = asset.kind === "captured" && onSelect;

  return (
    <article
      className={`sphere-shard sphere-shard--${asset.kind} sphere-shard--${asset.tone} ${
        asset.entryMotion ? `sphere-shard--entry-${asset.entryMotion}` : ""
      } ${isActive ? "sphere-shard--active" : ""} ${isInteractive ? "sphere-shard--interactive" : ""} ${
        isMuted ? "sphere-shard--muted" : ""
      } ${clusterId ? `sphere-shard--cluster-${clusterId}` : ""} sphere-shard--${asset.orbPlacement.lane} sphere-shard--${hemisphere}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${dimensions.width}px`,
        height: `${dimensions.height}px`,
        opacity,
        zIndex,
        filter: `blur(${blur}px) saturate(${0.86 + frontness * 0.28})`,
        transform: `translate3d(calc(-50% + ${driftX}px), calc(-50% + ${driftY}px), 0) rotate(${rotation}deg) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`,
        animationDelay: `${asset.orbPlacement.phase}s`,
      }}
      onClick={() => {
        if (isInteractive) {
          onSelect(asset);
        }
      }}
      onKeyDown={(event) => {
        if (!isInteractive) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(asset);
        }
      }}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
    >
      <div className="sphere-shard__aura" />
      <div className="sphere-shard__trail" />
      <div className="sphere-shard__plate">
        <div className="sphere-shard__shell" />
        {asset.imageUrl ? (
          <img
            className="sphere-shard__image sphere-shard__image--photo"
            src={asset.imageUrl}
            alt={asset.title}
            draggable={false}
          />
        ) : (
          <div className="sphere-shard__image sphere-shard__image--abstract" />
        )}
        <div className="sphere-shard__veil" />
        <div className="sphere-shard__edge-light" />
        <div
          className="sphere-shard__shadow"
          style={{ opacity: 0.2 + shadowDepth * 0.22 }}
        />
      </div>
      <div className="sphere-shard__meta">
        <p className="sphere-shard__eyebrow">
          {asset.kind === "captured"
            ? "Captured reference"
            : asset.kind === "crop"
              ? "Ingredient detail"
              : "Generated output"}
        </p>
        <h3>{asset.title}</h3>
        <div className="sphere-shard__chips" aria-label="Semantic labels">
          {asset.labels.map((label) => (
            <span key={`${asset.id}-${label}`} className="sphere-chip">
              {label}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
