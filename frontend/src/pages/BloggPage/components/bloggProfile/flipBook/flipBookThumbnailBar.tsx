import type { FlipBookThumbnailBarProps } from "./flipBookTypes";
import "./flipBookThumbnailBar.css";

/** Return the first BlockNote image URL contained on this page. */
function findFirstImageUrl(blocks: unknown[]): string | undefined {
  for (const item of blocks) {
    if (!item || typeof item !== "object") continue;

    const block = item as {
      type?: unknown;
      props?: { url?: unknown; src?: unknown };
      children?: unknown;
    };

    if (block.type === "image") {
      const candidate = block.props?.url ?? block.props?.src;
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    if (Array.isArray(block.children)) {
      const nestedImage = findFirstImageUrl(block.children);
      if (nestedImage) return nestedImage;
    }
  }

  return undefined;
}

const FlipBookThumbnailBar = ({
  pages,
  currentSpread,
  onSelect,
}: FlipBookThumbnailBarProps) => {
  return (
    <div
      className="flex items-center justify-center gap-2 overflow-x-auto px-4 py-2 scrollbar-none"
      aria-label="Flipbook page navigation"
    >
      {pages.map((page, index) => {
        const isActive = index === currentSpread || index === currentSpread + 1;
        const isBlank = page.pageKind === "blank" || page.id === "blank";
        // The cover page has no body blocks of its own. Its preview should use
        // the note's content so the cover thumbnail can still show its first image.
        const imageBlocks = page.pageKind === "detail-cover"
          ? page.blogg?.content ?? []
          : page.content ?? [];
        const imageUrl = isBlank ? undefined : findFirstImageUrl(imageBlocks);

        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onSelect(index)}
            aria-label={`Go to page ${index + 1}`}
            aria-current={isActive ? "page" : undefined}
            className={`flipbook-thumbnail relative shrink-0 overflow-hidden bg-white transition-all duration-300 ${
              isActive
                ? "flipbook-active-thumbnail ring-2 ring-white"
                : "opacity-60 hover:opacity-100"
            }`}
          >
            {imageUrl ? (
              <img
                className="flipbook-thumbnail-image"
                src={imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="flipbook-thumbnail-blank" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default FlipBookThumbnailBar;
