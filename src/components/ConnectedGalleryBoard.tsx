import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetKind, BoardAsset } from "../types/assets";

type ConnectedGalleryBoardProps = {
  assets: BoardAsset[];
  selectedAssetId: string | null;
  onSelectAsset: (asset: BoardAsset) => void;
};

type Point = {
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

type DragState = {
  assetId: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  originClientX: number;
  originClientY: number;
  moved: boolean;
};

const CARD_SIZES: Record<AssetKind, Size> = {
  captured: { width: 196, height: 144 },
  crop: { width: 144, height: 106 },
  generated: { width: 136, height: 102 },
};

function clamp(value: number, min: number, max: number) {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function getAssetSize(asset: BoardAsset) {
  return CARD_SIZES[asset.kind];
}

function buildDefaultPositions(assets: BoardAsset[], boardSize: Size) {
  const next: Record<string, Point> = {};
  const viewableAssets = assets.filter((asset) => asset.imageUrl);
  const capturedAssets = viewableAssets.filter((asset) => asset.kind === "captured");
  const orphanAssets = viewableAssets.filter(
    (asset) => asset.kind !== "captured" && !asset.parentAssetId,
  );

  const leftInset = Math.max(48, boardSize.width * 0.14);
  const topBandY = Math.max(76, boardSize.height * 0.24);
  const captureSpacing = 260;

  capturedAssets.forEach((asset, index) => {
    const size = getAssetSize(asset);
    const x = leftInset + index * captureSpacing;
    const y = topBandY + (index % 2) * 56;
    next[asset.id] = {
      x: clamp(x, 16, boardSize.width - size.width - 16),
      y: clamp(y, 16, boardSize.height - size.height - 16),
    };
  });

  capturedAssets.forEach((asset) => {
    const parentPosition = next[asset.id];
    if (!parentPosition) {
      return;
    }

    const linkedChildren = viewableAssets.filter(
      (candidate) => candidate.parentAssetId === asset.id,
    );

    linkedChildren.forEach((childAsset, childIndex) => {
      const childSize = getAssetSize(childAsset);
      const childCount = Math.max(1, linkedChildren.length);
      const spread = Math.min(Math.PI * 0.92, Math.PI * (0.32 * childCount));
      const startAngle = -Math.PI / 2 - spread / 2;
      const angle = startAngle + (spread * childIndex) / Math.max(1, childCount - 1);
      const radius = 170 + (childIndex % 2) * 32;
      const x = parentPosition.x + Math.cos(angle) * radius;
      const y = parentPosition.y + 182 + Math.sin(angle) * 48;

      next[childAsset.id] = {
        x: clamp(x, 16, boardSize.width - childSize.width - 16),
        y: clamp(y, 16, boardSize.height - childSize.height - 16),
      };
    });
  });

  orphanAssets.forEach((asset, index) => {
    const size = getAssetSize(asset);
    const row = Math.floor(index / 5);
    const col = index % 5;
    const x = 70 + col * 192;
    const y = boardSize.height * 0.68 + row * 132;
    next[asset.id] = {
      x: clamp(x, 16, boardSize.width - size.width - 16),
      y: clamp(y, 16, boardSize.height - size.height - 16),
    };
  });

  return next;
}

export function ConnectedGalleryBoard({
  assets,
  selectedAssetId,
  onSelectAsset,
}: ConnectedGalleryBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const assetsByIdRef = useRef(new Map<string, BoardAsset>());

  const [boardSize, setBoardSize] = useState<Size>({ width: 1200, height: 760 });
  const [positions, setPositions] = useState<Record<string, Point>>({});

  const visibleAssets = useMemo(
    () => assets.filter((asset) => typeof asset.imageUrl === "string" && asset.imageUrl.length > 0),
    [assets],
  );

  useEffect(() => {
    assetsByIdRef.current = new Map(assets.map((asset) => [asset.id, asset]));
  }, [assets]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setBoardSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPositions((currentPositions) => {
      const defaults = buildDefaultPositions(visibleAssets, boardSize);
      const nextPositions: Record<string, Point> = {};

      visibleAssets.forEach((asset) => {
        const existingPosition = currentPositions[asset.id];
        const fallbackPosition = defaults[asset.id] ?? { x: 28, y: 28 };
        nextPositions[asset.id] = existingPosition ?? fallbackPosition;
      });

      return nextPositions;
    });
  }, [visibleAssets, boardSize]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current;
      const container = containerRef.current;
      if (!dragState || !container || event.pointerId !== dragState.pointerId) {
        return;
      }

      const draggedAsset = assetsByIdRef.current.get(dragState.assetId);
      if (!draggedAsset) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const size = getAssetSize(draggedAsset);
      const x = clamp(
        event.clientX - rect.left - dragState.offsetX,
        12,
        rect.width - size.width - 12,
      );
      const y = clamp(
        event.clientY - rect.top - dragState.offsetY,
        12,
        rect.height - size.height - 12,
      );

      if (!dragState.moved) {
        const deltaX = Math.abs(event.clientX - dragState.originClientX);
        const deltaY = Math.abs(event.clientY - dragState.originClientY);
        if (deltaX + deltaY > 4) {
          dragState.moved = true;
        }
      }

      setPositions((currentPositions) => ({
        ...currentPositions,
        [dragState.assetId]: { x, y },
      }));
    }

    function handlePointerUp(event: PointerEvent) {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      dragStateRef.current = null;

      if (!dragState.moved) {
        const asset = assetsByIdRef.current.get(dragState.assetId);
        if (asset) {
          onSelectAsset(asset);
        }
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [onSelectAsset]);

  const linkSegments = useMemo(() => {
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));

    return visibleAssets
      .filter((asset) => asset.parentAssetId != null && positions[asset.id] != null)
      .flatMap((asset) => {
        const parentId = asset.parentAssetId;
        if (!parentId) {
          return [];
        }

        const parent = assetById.get(parentId);
        if (!parent || !positions[parentId]) {
          return [];
        }

        const parentSize = getAssetSize(parent);
        const childSize = getAssetSize(asset);
        const startX = positions[parentId].x + parentSize.width / 2;
        const startY = positions[parentId].y + parentSize.height / 2;
        const endX = positions[asset.id].x + childSize.width / 2;
        const endY = positions[asset.id].y + childSize.height / 2;

        return [
          {
            id: `${parentId}-${asset.id}`,
            startX,
            startY,
            endX,
            endY,
            selected: selectedAssetId === parentId || selectedAssetId === asset.id,
          },
        ];
      });
  }, [assets, positions, selectedAssetId, visibleAssets]);

  return (
    <div className="connected-gallery-board" ref={containerRef}>
      <svg
        className="connected-gallery-board__links"
        aria-hidden="true"
        viewBox={`0 0 ${Math.max(1, boardSize.width)} ${Math.max(1, boardSize.height)}`}
        preserveAspectRatio="none"
      >
        {linkSegments.map((segment) => (
          <line
            key={segment.id}
            className={`connected-gallery-board__link ${
              segment.selected ? "connected-gallery-board__link--selected" : ""
            }`}
            x1={segment.startX}
            y1={segment.startY}
            x2={segment.endX}
            y2={segment.endY}
          />
        ))}
      </svg>

      {visibleAssets.map((asset) => {
        const position = positions[asset.id];
        if (!position || !asset.imageUrl) {
          return null;
        }

        const size = getAssetSize(asset);
        const cardClassName = [
          "connected-gallery-card",
          `connected-gallery-card--${asset.kind}`,
          selectedAssetId === asset.id ? "connected-gallery-card--selected" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <article
            key={asset.id}
            className={cardClassName}
            style={{
              width: size.width,
              height: size.height,
              transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();

              const container = containerRef.current;
              if (!container) {
                return;
              }

              const rect = container.getBoundingClientRect();
              dragStateRef.current = {
                assetId: asset.id,
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left - position.x,
                offsetY: event.clientY - rect.top - position.y,
                originClientX: event.clientX,
                originClientY: event.clientY,
                moved: false,
              };
            }}
          >
            <img src={asset.imageUrl} alt={asset.title} draggable={false} />
            <div className="connected-gallery-card__pills">
              {asset.labels.slice(0, 3).map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="connected-gallery-card__meta">
              <strong>{asset.title}</strong>
              <span>{asset.kind}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
