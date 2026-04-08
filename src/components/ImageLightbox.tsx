import { useEffect, useMemo } from "react";
import type { BoardAsset } from "../types/assets";

type ImageLightboxProps = {
  assets: BoardAsset[];
  activeAssetId: string | null;
  onClose: () => void;
  onChangeAsset: (assetId: string) => void;
};

function wrapIndex(index: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (index + total) % total;
}

export function ImageLightbox({
  assets,
  activeAssetId,
  onClose,
  onChangeAsset,
}: ImageLightboxProps) {
  const viewableAssets = useMemo(
    () => assets.filter((asset) => typeof asset.imageUrl === "string" && asset.imageUrl.length > 0),
    [assets],
  );

  const activeIndex = useMemo(() => {
    if (!activeAssetId) {
      return -1;
    }

    return viewableAssets.findIndex((asset) => asset.id === activeAssetId);
  }, [activeAssetId, viewableAssets]);

  const activeAsset = activeIndex >= 0 ? viewableAssets[activeIndex] : null;

  useEffect(() => {
    if (!activeAsset) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (viewableAssets.length <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        const nextIndex = wrapIndex(activeIndex - 1, viewableAssets.length);
        onChangeAsset(viewableAssets[nextIndex].id);
      }

      if (event.key === "ArrowRight") {
        const nextIndex = wrapIndex(activeIndex + 1, viewableAssets.length);
        onChangeAsset(viewableAssets[nextIndex].id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeAsset, activeIndex, onChangeAsset, onClose, viewableAssets]);

  if (!activeAsset?.imageUrl) {
    return null;
  }

  const canNavigate = viewableAssets.length > 1;
  const prevAssetId = canNavigate
    ? viewableAssets[wrapIndex(activeIndex - 1, viewableAssets.length)].id
    : null;
  const nextAssetId = canNavigate
    ? viewableAssets[wrapIndex(activeIndex + 1, viewableAssets.length)].id
    : null;

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded image view"
      onClick={onClose}
    >
      {prevAssetId ? (
        <button
          type="button"
          className="image-lightbox__nav image-lightbox__nav--prev"
          onClick={(event) => {
            event.stopPropagation();
            onChangeAsset(prevAssetId);
          }}
          aria-label="View previous image"
        >
          {"<"}
        </button>
      ) : null}

      <figure
        className="image-lightbox__panel"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={activeAsset.imageUrl}
          alt={activeAsset.title}
          className="image-lightbox__image"
        />

        <button
          type="button"
          className="image-lightbox__close"
          onClick={onClose}
          aria-label="Close image viewer"
        >
          ×
        </button>
      </figure>

      {nextAssetId ? (
        <button
          type="button"
          className="image-lightbox__nav image-lightbox__nav--next"
          onClick={(event) => {
            event.stopPropagation();
            onChangeAsset(nextAssetId);
          }}
          aria-label="View next image"
        >
          {">"}
        </button>
      ) : null}
    </div>
  );
}
