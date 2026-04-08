import { useState } from "react";
import type { ClusterId, ClusterZone } from "../../lib/mockClusters";
import type { BoardAsset } from "../../types/assets";
import { SphereAssetShard } from "./SphereAssetShard";
import { SphereAtmosphere } from "./SphereAtmosphere";
import { SphereZoneOverlay } from "./SphereZoneOverlay";
import { getSphereProjection } from "./sphereProjection";

type InspirationSphereProps = {
  assets: BoardAsset[];
  activeAssetId?: string;
  clusterAssignments?: Record<string, ClusterId>;
  clusterZones?: ClusterZone[];
  isClustered?: boolean;
  isExtracting?: boolean;
  selectedClusterId?: ClusterId | null;
  selectedAsset?: BoardAsset | null;
  onSelectAsset?: (asset: BoardAsset) => void;
  onSelectCluster?: (clusterId: ClusterId) => void;
};

export function InspirationSphere({
  assets,
  activeAssetId,
  clusterAssignments,
  clusterZones,
  isClustered = false,
  isExtracting = false,
  selectedClusterId,
  selectedAsset,
  onSelectAsset,
  onSelectCluster,
}: InspirationSphereProps) {
  const [pointerDrift, setPointerDrift] = useState({ x: 0, y: 0 });
  const assetProjectionState = assets
    .map((asset) => ({
      asset,
      projection: getSphereProjection(asset, { pointerDrift }),
    }))
    .sort((left, right) => left.projection.frontness - right.projection.frontness);
  const rearAssets = assetProjectionState.filter(
    ({ projection }) => projection.hemisphere === "rear",
  );
  const frontAssets = assetProjectionState.filter(
    ({ projection }) => projection.hemisphere === "front",
  );

  return (
    <section className="sphere-stage">
      <div className="sphere-stage__copy">
        <p className="sphere-stage__eyebrow">Living inspiration sphere</p>
        <h2>
          Captured references are absorbed into one cinematic field rather than
          living as separate cards.
        </h2>
      </div>

      <div
        className={`sphere-field ${isClustered ? "sphere-field--clustered" : ""} ${
          isExtracting ? "sphere-field--extracting" : ""
        }`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width - 0.5;
          const y = (event.clientY - bounds.top) / bounds.height - 0.5;
          setPointerDrift({ x, y });
        }}
        onPointerLeave={() => setPointerDrift({ x: 0, y: 0 })}
      >
        <SphereAtmosphere pointerDrift={pointerDrift} isClustered={isClustered} />
        <div className="sphere-field__halo sphere-field__halo--outer" />
        <div className="sphere-field__halo sphere-field__halo--inner" />
        <div className="sphere-field__glow sphere-field__glow--top" />
        <div className="sphere-field__glow sphere-field__glow--bottom" />
        <div className="sphere-field__asset-layer sphere-field__asset-layer--rear">
          {rearAssets.map(({ asset }) => {
            const clusterId = clusterAssignments?.[asset.id];
            const isMuted =
              selectedClusterId != null &&
              clusterId != null &&
              clusterId !== selectedClusterId;

            return (
              <SphereAssetShard
                key={asset.id}
                asset={asset}
                clusterId={clusterId}
                isActive={activeAssetId === asset.id}
                isMuted={isMuted}
                pointerDrift={pointerDrift}
                onSelect={asset.kind === "captured" ? onSelectAsset : undefined}
              />
            );
          })}
        </div>
        <div
          className="sphere-field__orb"
          style={{
            transform: `translate3d(${pointerDrift.x * 12}px, ${pointerDrift.y * 12}px, 0) rotateX(${
              pointerDrift.y * -6
            }deg) rotateY(${pointerDrift.x * 9}deg)`,
          }}
        >
          <div className="sphere-field__orb-shell" />
          <div className="sphere-field__orb-shell sphere-field__orb-shell--inner" />
          <div className="sphere-field__orb-ring sphere-field__orb-ring--horizontal" />
          <div className="sphere-field__orb-ring sphere-field__orb-ring--angled" />
          <div className="sphere-field__orb-ring sphere-field__orb-ring--vertical" />
          <div className="sphere-field__orb-highlight" />
          <div className="sphere-field__orb-shadow" />
          <div className="sphere-field__orb-haze" />
          <div className="sphere-field__orb-core" />
        </div>

        {isClustered
          ? clusterZones?.map((zone) => (
              <SphereZoneOverlay
                key={zone.id}
                zone={zone}
                isSelected={selectedClusterId === zone.id}
                onSelect={onSelectCluster}
              />
            ))
          : null}

        <div className="sphere-field__asset-layer sphere-field__asset-layer--front">
          {frontAssets.map(({ asset }) => {
            const clusterId = clusterAssignments?.[asset.id];
            const isMuted =
              selectedClusterId != null &&
              clusterId != null &&
              clusterId !== selectedClusterId;

            return (
              <SphereAssetShard
                key={asset.id}
                asset={asset}
                clusterId={clusterId}
                isActive={activeAssetId === asset.id}
                isMuted={isMuted}
                pointerDrift={pointerDrift}
                onSelect={asset.kind === "captured" ? onSelectAsset : undefined}
              />
            );
          })}
        </div>

        <div className="sphere-stage__focus">
          {selectedAsset ? (
            <>
              <p className="sphere-stage__focus-label">Focused capture</p>
              <strong>{selectedAsset.title}</strong>
              <span>Tap into the crop studio to isolate a reusable ingredient.</span>
            </>
          ) : isClustered ? (
            <>
              <p className="sphere-stage__focus-label">Cluster view</p>
              <strong>
                {selectedClusterId
                  ? clusterZones?.find((zone) => zone.id === selectedClusterId)?.title ??
                    "Cluster selected"
                  : "Select a zone"}
              </strong>
              <span>The orb stays intact while assets slide into readable semantic bands.</span>
            </>
          ) : (
            <>
              <p className="sphere-stage__focus-label">Interaction</p>
              <strong>Capture, absorb, refine</strong>
              <span>
                New photos settle into the sphere surface. Captured shards remain crop-ready.
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
