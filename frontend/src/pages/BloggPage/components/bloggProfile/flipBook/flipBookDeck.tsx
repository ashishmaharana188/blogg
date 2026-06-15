import FlipBookPage from "./FlipBookPage";
import type { FlipBookDeckProps } from "./flipBookTypes";

const MAX_VISIBLE_DISTANCE = 4;

const FlipBookDeck = ({ pages, currentSpread }: FlipBookDeckProps) => {
  return (
    <div
      className="
        flipbook-deck
        relative
        mx-auto
      "
      style={{
        width: "min(100vw, 1200px)",
        height: "min(65vh, 650px)",
      }}
    >
      {pages.map((page, index) => {
        const distance = index - currentSpread;

        if (Math.abs(distance) > MAX_VISIBLE_DISTANCE) {
          return null;
        }

        const absDistance = Math.abs(distance);

        let translateX = 0;
        let rotateY = 0;
        let scale = 1;
        let opacity = 1;
        let zIndex = 100;

        /*
         * LEFT STACK
         */

        if (distance <= -3) {
          const depth = absDistance - 2;

          translateX = -210 - depth * 18;

          rotateY = 28;

          scale = 0.95 - depth * 0.02;

          opacity = 0.85 - depth * 0.1;

          zIndex = 70 - depth;
        } else if (distance === -2) {

        /*
         * LEFT SUPPORT PAGE
         */
          translateX = -185;

          rotateY = 24;

          scale = 0.97;

          zIndex = 80;
        } else if (distance === 0) {

        /*
         * LEFT VISIBLE PAGE
         */
          translateX = -145;

          rotateY = 12;

          scale = 1;

          zIndex = 100;
        } else if (distance === 1) {

        /*
         * RIGHT VISIBLE PAGE
         */
          translateX = 145;

          rotateY = -12;

          scale = 1;

          zIndex = 101;
        } else if (distance === 2) {

        /*
         * RIGHT SUPPORT PAGE
         */
          translateX = 185;

          rotateY = -24;

          scale = 0.97;

          zIndex = 80;
        } else if (distance >= 3) {

        /*
         * RIGHT STACK
         */
          const depth = distance - 2;

          translateX = 210 + depth * 18;

          rotateY = -28;

          scale = 0.95 - depth * 0.02;

          opacity = 0.85 - depth * 0.1;

          zIndex = 70 - depth;
        }

        return (
          <div
            key={page.id}
            className="
              flipbook-card

              absolute
              left-1/2
              top-1/2
            "
            style={{
              transform: `
                translate(-50%, -50%)
                translateX(${translateX}px)
                rotateY(${rotateY}deg)
                scale(${scale})
              `,

              opacity,

              zIndex,
            }}
          >
            <FlipBookPage page={page} side={distance <= 0 ? "left" : "right"} />
          </div>
        );
      })}
    </div>
  );
};

export default FlipBookDeck;
