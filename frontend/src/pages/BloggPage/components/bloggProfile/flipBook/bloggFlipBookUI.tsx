import { useEffect, useMemo, useState } from "react";

import "./flipBook.css";

import FlipBookDeck from "./flipBookDeck";
import FlipBookThumbnailBar from "./flipBookThumbnailBar";

import { dummyPages } from "./flipBookDummyData";

import type { BlogFlipBookUIProps, FlipBookPageType } from "./flipBookTypes";

const BlogFlipBookUI = ({ pages }: BlogFlipBookUIProps) => {
  /*
   * Use dummy pages when none supplied.
   */

  const sourcePages = pages?.length ? pages : dummyPages;

  /*
   * Ensure even page count.
   */

  const bookPages = useMemo<FlipBookPageType[]>(() => {
    if (sourcePages.length % 2 === 0) {
      return sourcePages;
    }

    return [
      ...sourcePages,

      {
        id: "blank",
        image: "",
        title: "",
      },
    ];
  }, [sourcePages]);

  /*
   * Current LEFT page.
   *
   * Spread 1:
   * 0 1
   *
   * Spread 2:
   * 2 3
   */

  const [currentSpread, setCurrentSpread] = useState(0);

  const maxSpread = Math.max(0, bookPages.length - 2);

  /*
   * Navigation
   */

  const goNext = () => {
    setCurrentSpread((prev) => Math.min(prev + 2, maxSpread));
  };

  const goPrevious = () => {
    setCurrentSpread((prev) => Math.max(prev - 2, 0));
  };

  /*
   * Keyboard navigation
   */

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        goNext();
      }

      if (event.key === "ArrowLeft") {
        goPrevious();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [maxSpread]);

  /*
   * Display values
   */

  const spreadNumber = currentSpread / 2 + 1;

  const totalSpreads = bookPages.length / 2;

  return (
    <div
      className="
        min-h-screen
        bg-black

        px-4
        py-6

        flex
        flex-col
        items-center
      "
    >
      {/* Header */}

      <div className="mb-4 text-center">
        <h1
          className="
            text-4xl
            font-bold
            text-white
          "
        >
          FlipBook Profile
        </h1>

        <p
          className="
            mt-2
            text-sm
            text-white/70
          "
        >
          Spread {spreadNumber}
          {" / "}
          {totalSpreads}
        </p>
      </div>

      {/* Deck */}

      <FlipBookDeck pages={bookPages} currentSpread={currentSpread} />

      {/* Navigation */}

      <div
        className="
          mt-4

          flex
          flex-wrap
          items-center
          justify-center
          gap-6

          text-white
        "
      >
        <button
          onClick={goPrevious}
          disabled={currentSpread === 0}
          className="
            rounded-lg
            border
            border-white/20

            px-4
            py-2

            transition

            hover:bg-white/10

            disabled:cursor-not-allowed
            disabled:opacity-30
          "
        >
          ← Prev
        </button>

        <div
          className="
            text-center
            text-sm
            text-white/80
          "
        >
          {currentSpread === 0
            ? "Cover"
            : `Artworks ${currentSpread + 1}–${currentSpread + 2}`}
          {" · "}
          Spread {spreadNumber} of {totalSpreads}
        </div>

        <button
          onClick={goNext}
          disabled={currentSpread >= maxSpread}
          className="
            rounded-lg
            border
            border-white/20

            px-4
            py-2

            transition

            hover:bg-white/10

            disabled:cursor-not-allowed
            disabled:opacity-30
          "
        >
          Next →
        </button>
      </div>

      {/* Thumbnails */}

      <div
        className="
          mt-6
          w-full
          max-w-5xl
        "
      >
        <FlipBookThumbnailBar
          pages={bookPages}
          currentSpread={currentSpread}
          onSelect={(pageIndex) => {
            setCurrentSpread(pageIndex - (pageIndex % 2));
          }}
        />
      </div>

      {/* Footer */}

      <p
        className="
          mt-4
          text-xs
          text-white/50
        "
      >
        Artwork by Hachimi
      </p>
    </div>
  );
};

export default BlogFlipBookUI;
