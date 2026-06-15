import FlipBookPage from "./FlipBookPage";
import type { FlipBookSpreadProps } from "./flipBookTypes";

const PAGE_WIDTH = 420;
const STACK_OFFSET = 12;
const STACK_SIZE = 3;

const FlipBookSpread = ({ pages, currentSpread }: FlipBookSpreadProps) => {
  const leftPage = pages[currentSpread];
  const rightPage = pages[currentSpread + 1];

  return (
    <div
      className="
   relative
    w-[1200px]
    h-[700px]
    mx-auto
      "
    >
      {/* LEFT STACK */}
      {Array.from({ length: STACK_SIZE }).map((_, index) => {
        const pageIndex = currentSpread - (STACK_SIZE - index);

        if (pageIndex < 0) {
          return null;
        }

        return (
          <div
            key={`left-${pageIndex}`}
            className="
                absolute
                transition-all
                duration-500
              "
            style={{
              transform: `
                  translateX(${
                    -(PAGE_WIDTH / 2) - STACK_OFFSET * (STACK_SIZE - index)
                  }px)
                  rotateY(6deg)
                  scale(${0.96 + index * 0.01})
                `,
              zIndex: index,
            }}
          >
            <FlipBookPage page={pages[pageIndex]} side="left" />
          </div>
        );
      })}

      {/* LEFT VISIBLE PAGE */}
      {leftPage && (
        <div
          className="
            absolute
            transition-all
            duration-500
          "
          style={{
            transform: `translateX(-${PAGE_WIDTH / 2}px)`,

            zIndex: 100,
          }}
        >
          <FlipBookPage page={leftPage} side="left" />
        </div>
      )}

      {/* RIGHT VISIBLE PAGE */}
      {rightPage && (
        <div
          className="
            absolute
            transition-all
            duration-500
          "
          style={{
            transform: `translateX(${PAGE_WIDTH / 2}px)`,

            zIndex: 101,
          }}
        >
          <FlipBookPage page={rightPage} side="right" />
        </div>
      )}

      {/* RIGHT STACK */}
      {Array.from({ length: STACK_SIZE }).map((_, index) => {
        const pageIndex = currentSpread + 2 + index;

        if (pageIndex >= pages.length) {
          return null;
        }

        return (
          <div
            key={`right-${pageIndex}`}
            className="
                absolute
                transition-all
                duration-500
              "
            style={{
              transform: `
                  translateX(${PAGE_WIDTH / 2 + STACK_OFFSET * (index + 1)}px)
                  rotateY(-6deg)
                  scale(${0.99 - index * 0.01})
                `,
              zIndex: STACK_SIZE - index,
            }}
          >
            <FlipBookPage page={pages[pageIndex]} side="right" />
          </div>
        );
      })}

      {/* BOOK SPINE */}
      <div
        className="
    absolute
    h-[580px]
    w-[34px]

    rounded-full

    pointer-events-none

    flipbook-spine-shadow
  "
        style={{
          zIndex: 150,

          background:
            "linear-gradient(to right, rgba(0,0,0,0.28), rgba(255,255,255,0.08), transparent)",
        }}
      />
    </div>
  );
};

export default FlipBookSpread;
