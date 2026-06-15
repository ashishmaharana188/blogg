import FlipBookPage from "./FlipBookPage";
import type { FlipBookPageType } from "./flipBookTypes";

type TurningPageProps = {
  frontPage: FlipBookPageType;
  backPage?: FlipBookPageType;

  direction: "next" | "previous";

  isTurning: boolean;

  onAnimationEnd?: () => void;
};

const PAGE_WIDTH = 420;
const PAGE_HEIGHT = 580;

const TurningPage = ({
  frontPage,
  backPage,
  direction,
  isTurning,
  onAnimationEnd,
}: TurningPageProps) => {
  const rotation = isTurning ? (direction === "next" ? -180 : 180) : 0;

  return (
    <div
      className="
        absolute
        top-1/2
        pointer-events-none
      "
      style={{
        left: "50%",

        width: PAGE_WIDTH,

        height: PAGE_HEIGHT,

        transformStyle: "preserve-3d",

        transformOrigin: direction === "next" ? "left center" : "right center",

        transform: `
          translateY(-50%)
          rotateY(${rotation}deg)
        `,

        transition: "transform 900ms cubic-bezier(0.77,0,0.175,1)",

        zIndex: 500,
      }}
      onTransitionEnd={onAnimationEnd}
    >
      {/* FRONT FACE */}

      <div
        style={{
          position: "absolute",

          inset: 0,

          backfaceVisibility: "hidden",
        }}
      >
        <FlipBookPage
          page={frontPage}
          side={direction === "next" ? "right" : "left"}
        />
      </div>

      {/* BACK FACE */}

      {backPage && (
        <div
          style={{
            position: "absolute",

            inset: 0,

            transform: "rotateY(180deg)",

            backfaceVisibility: "hidden",
          }}
        >
          <FlipBookPage
            page={backPage}
            side={direction === "next" ? "left" : "right"}
          />
        </div>
      )}

      {/* PAGE SHADOW */}

      <div className="flipbook-turning-shadow" />
    </div>
  );
};

export default TurningPage;
