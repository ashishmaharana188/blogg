import type { FlipBookPageProps } from "./flipBookTypes";

const PAGE_WIDTH = 320;
const PAGE_HEIGHT = 460;

const FlipBookPage = ({ page, side }: FlipBookPageProps) => {
  const isBlank = page.id === "blank";

  return (
    <div
      className="
        flipbook-paper
        flipbook-page-shadow

        relative
        overflow-hidden
        rounded-[28px]
        bg-white
        select-none
      "
      style={{
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
      }}
    >
      {/* Artwork */}
      {!isBlank && (
        <img
          src={page.image}
          alt={page.title ?? "Artwork"}
          draggable={false}
          className="
            absolute
            inset-0
            h-full
            w-full
            object-cover
          "
        />
      )}

      {/* Blank filler page */}
      {isBlank && (
        <div
          className="
            absolute
            inset-0
            bg-black
          "
        />
      )}

      {/* Paper edge */}
      <div
        className={`
          absolute
          top-2
          bottom-2
          w-[4px]
          rounded-full

          ${
            side === "left"
              ? "left-[-2px] flipbook-page-edge-left"
              : "right-[-2px] flipbook-page-edge-right"
          }
        `}
      />

      {/* Page number */}
      {!isBlank && (
        <div
          className={`
            absolute
            bottom-4
            text-sm
            font-medium
            text-white

            ${side === "left" ? "left-4" : "right-4"}
          `}
          style={{
            textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          {page.id}
        </div>
      )}

      {/* Optional title */}
      {!isBlank && page.title && (
        <div
          className="
            absolute
            left-4
            right-4
            bottom-10

            text-xs
            text-white/80
            truncate
          "
          style={{
            textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          {page.title}
        </div>
      )}
    </div>
  );
};

export default FlipBookPage;
