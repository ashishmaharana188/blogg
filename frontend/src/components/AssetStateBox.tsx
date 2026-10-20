import { useMemo } from "react";
import { publicStateAssets } from "virtual:public-state-assets";
import "./assetStateBox.css";

type AssetState = "loading" | "error";

type AssetStateBoxProps = {
  status: AssetState;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
};

const SIZE_PRESETS = [
  { name: "xs", pixels: 40 },
  { name: "sm", pixels: 64 },
  { name: "md", pixels: 96 },
  { name: "lg", pixels: 160 },
  { name: "xl", pixels: 224 },
] as const;

export default function AssetStateBox({
  status,
  onRetry,
  compact = false,
  className = "",
}: AssetStateBoxProps) {
  const selection = useMemo(() => {
    const assets = publicStateAssets;
    const asset = assets.length ? assets[Math.floor(Math.random() * assets.length)] : null;
    const size = SIZE_PRESETS[Math.floor(Math.random() * SIZE_PRESETS.length)];
    return { asset, size: size.name };
  }, [status]);

  const boxClassName = `asset-state-square asset-state-square--${selection.size}`;
  const image = selection.asset ? (
    <img
      className="asset-state-image"
      src={selection.asset}
      alt=""
      aria-hidden="true"
      onError={(event) => { event.currentTarget.style.display = "none"; }}
    />
  ) : null;
  const fallback = <span className="asset-state-fallback" aria-hidden="true" />;

  const box = status === "error" && onRetry ? (
    <button
      type="button"
      className={`${boxClassName} asset-state-square--retry`}
      onClick={onRetry}
      aria-label="Retry loading content"
      title="Retry"
    >
      {fallback}
      {image}
      <span className="asset-state-retry-mark" aria-hidden="true">↻</span>
    </button>
  ) : (
    <div className={boxClassName}>
      {fallback}
      {image}
    </div>
  );

  return (
    <div
      className={`asset-state-stage ${compact ? "asset-state-stage--compact" : ""} ${className}`.trim()}
      role={status === "loading" ? "status" : "alert"}
      aria-label={status === "loading" ? "Content is loading" : "Content is unavailable"}
    >
      {box}
    </div>
  );
}
