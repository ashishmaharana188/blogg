import type { FlipBookThumbnailBarProps } from "./flipBookTypes";

const FlipBookThumbnailBar = ({
  pages,
  currentSpread,
  onSelect,
}: FlipBookThumbnailBarProps) => {
  return (
    <div
      className="
        flex
        items-center
        justify-center
        gap-2

        overflow-x-auto

        px-4
        py-2

        scrollbar-none
      "
    >
      {pages.map((page, index) => {
        const isActive = index === currentSpread || index === currentSpread + 1;

        const isBlank = page.id === "blank";

        return (
          <button
            key={page.id}
            onClick={() => onSelect(index)}
            className={`
              flipbook-thumbnail

              relative
              shrink-0

              overflow-hidden

              transition-all
              duration-300

              ${
                isActive
                  ? "flipbook-active-thumbnail ring-2 ring-white"
                  : "opacity-60 hover:opacity-100"
              }
            `}
            // No inline width/height — controlled entirely by CSS
          >
            {!isBlank ? (
              <div className="flex h-full w-full items-center justify-center bg-white px-1 text-center font-serif text-[9px] text-black">
                {page.title || `Blog ${index + 1}`}
              </div>
            ) : (
              <div className="h-full w-full bg-black" />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default FlipBookThumbnailBar;
