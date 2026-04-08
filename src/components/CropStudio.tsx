import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { BoardAsset } from "../types/assets";

type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropStudioProps = {
  asset: BoardAsset | null;
  onClose: () => void;
  onCreateCrop: (selection: CropSelection) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeSelection(startX: number, startY: number, endX: number, endY: number) {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

export function CropStudio({ asset, onClose, onCreateCrop }: CropStudioProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [selection, setSelection] = useState<CropSelection | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setSelection(null);
    setDragStart(null);
  }, [asset?.id]);

  const canCreateCrop = useMemo(() => {
    if (!selection) {
      return false;
    }

    return selection.width >= 24 && selection.height >= 24;
  }, [selection]);

  if (!asset || !asset.imageUrl) {
    return null;
  }

  function getRelativePoint(event: ReactPointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left, 0, bounds.width),
      y: clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const point = getRelativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart) {
      return;
    }

    const point = getRelativePoint(event);
    setSelection(normalizeSelection(dragStart.x, dragStart.y, point.x, point.y));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = getRelativePoint(event);
    setSelection(normalizeSelection(dragStart.x, dragStart.y, point.x, point.y));
    setDragStart(null);
  }

  function handleCreateCrop() {
    if (!selection || !canCreateCrop || !imageRef.current) {
      return;
    }

    const displayWidth = imageRef.current.clientWidth;
    const displayHeight = imageRef.current.clientHeight;
    const naturalWidth = imageRef.current.naturalWidth;
    const naturalHeight = imageRef.current.naturalHeight;

    if (
      displayWidth === 0 ||
      displayHeight === 0 ||
      naturalWidth === 0 ||
      naturalHeight === 0
    ) {
      return;
    }

    onCreateCrop({
      x: selection.x / displayWidth,
      y: selection.y / displayHeight,
      width: selection.width / displayWidth,
      height: selection.height / displayHeight,
    });
  }

  return (
    <div className="crop-studio-overlay" role="dialog" aria-modal="true">
      <div className="crop-studio">
        <div className="crop-studio__header">
          <div>
            <p className="section-label">Focus / Crop</p>
            <h2>Pull a captured shard forward and isolate a reusable ingredient</h2>
          </div>
          <button className="crop-studio__close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="crop-studio__body">
          <div className="crop-studio__canvas-wrap">
            <div
              className="crop-studio__canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <img
                ref={imageRef}
                className="crop-studio__image"
                src={asset.imageUrl}
                alt={asset.title}
                draggable={false}
              />
              {selection ? (
                <div
                  className="crop-studio__selection"
                  style={{
                    left: `${selection.x}px`,
                    top: `${selection.y}px`,
                    width: `${selection.width}px`,
                    height: `${selection.height}px`,
                  }}
                />
              ) : null}
            </div>
          </div>

          <aside className="crop-studio__aside">
            <div className="crop-studio__note">
              <span className="section-label">Focused asset</span>
              <strong>{asset.title}</strong>
              <p>
                Draw a precise selection over the focused capture. Confirming the crop
                creates a smaller ingredient shard while preserving the original reference
                in the sphere.
              </p>
            </div>
            <div className="crop-studio__note">
              <span className="section-label">Labels</span>
              <strong>Lightweight, deterministic, and ready for replacement</strong>
              <p>
                New ingredient assets receive plausible local labels immediately,
                keeping the spatial field readable now while leaving the state
                ready for future AI tagging.
              </p>
            </div>
            <div className="crop-studio__actions">
              <button
                className="dock-button dock-button--ghost"
                type="button"
                onClick={() => setSelection(null)}
              >
                Reset selection
              </button>
              <button
                className="dock-button dock-button--primary"
                type="button"
                onClick={handleCreateCrop}
                disabled={!canCreateCrop}
              >
                Create ingredient
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
