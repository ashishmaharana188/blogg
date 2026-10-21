import { useState } from "react";
import { publicStateAssets } from "virtual:public-state-assets";
import "./assetStateBox.css";

type AssetState = "loading" | "error";

type AssetStateBoxProps = {
  status: AssetState;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
};

/** Choose a random public image, preferring a different image when possible. */
function chooseRandomAsset(current: string | null): string | null {
  if (publicStateAssets.length === 0) return null;
  const alternatives = publicStateAssets.filter((asset) => asset !== current);
  const choices = alternatives.length > 0 ? alternatives : publicStateAssets;
  return choices[Math.floor(Math.random() * choices.length)] ?? null;
}

export default function AssetStateBox({
  status,
  onRetry,
  compact = false,
  className = "",
}: AssetStateBoxProps) {
  const [asset, setAsset] = useState<string | null>(() => chooseRandomAsset(null));
  const statusLabel = status === "loading" ? "Loading content" : "Content is unavailable";

  const chooseAnotherImage = () => {
    setAsset((current) => chooseRandomAsset(current));
  };

  const retry = () => {
    // Change the artwork as soon as Retry is activated, then run the caller's retry.
    chooseAnotherImage();
    onRetry?.();
  };

  return (
    <div
      className={`asset-state-stage ${compact ? "asset-state-stage--compact" : ""} ${className}`.trim()}
      role="group"
      aria-label={statusLabel}
    >
      <span className="asset-state-sr-only" role={status === "loading" ? "status" : "alert"}>
        {statusLabel}
      </span>

      <div className="asset-state-content">
        <button
          type="button"
          className="asset-state-square"
          onClick={chooseAnotherImage}
          aria-label="Show another random image"
          title="Click for another image"
        >
          <span className="asset-state-fallback" aria-hidden="true" />
          {asset && (
            <img
              key={asset}
              className="asset-state-image"
              src={asset}
              alt=""
              aria-hidden="true"
              onError={chooseAnotherImage}
            />
          )}
        </button>

        {status === "error" && onRetry && (
          <button
            type="button"
            className="asset-state-retry-button"
            onClick={retry}
            aria-label="Retry loading content"
            title="Retry"
          >
            <span aria-hidden="true">↻</span> Retry
          </button>
        )}
      </div>
    </div>
  );
}
