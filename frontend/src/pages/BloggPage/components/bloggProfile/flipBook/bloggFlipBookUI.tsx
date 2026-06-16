import { useCallback, useEffect, useMemo, useState } from "react";

import FlipBookThumbnailBar from "./flipBookThumbnailBar";
import "./flipBook.css";
import { dummyPages } from "./flipBookDummyData";
import type { BlogFlipBookUIProps, FlipBookPageType } from "./flipBookTypes";

type TurnDirection = "next" | "previous";

type TurnState = {
  direction: TurnDirection;
  from: number;
  to: number;
};

type PagePaneProps = {
  page?: FlipBookPageType;
  side: "left" | "right";
  className?: string;
};

const normalizeSpread = (index: number) => index - (index % 2);

const PagePane = ({ page, side, className = "" }: PagePaneProps) => {
  const isBlank = !page || page.id === "blank";

  return (
    <div className={`flipbook-page flipbook-page-${side} ${className}`}>
      {!isBlank ? (
        <img
          src={page.image}
          alt={page.title ?? `Artwork ${page.id}`}
          draggable={false}
          className="flipbook-page-image"
        />
      ) : (
        <div className="flipbook-page-blank" />
      )}

      {!isBlank && <span className="flipbook-page-number">{page.id}</span>}
    </div>
  );
};

const TurningSheet = ({
  pages,
  turn,
  onDone,
}: {
  pages: FlipBookPageType[];
  turn: TurnState;
  onDone: () => void;
}) => {
  const isNext = turn.direction === "next";
  const frontPage = pages[isNext ? turn.from + 1 : turn.from];
  const backPage = pages[isNext ? turn.to : turn.to + 1];

  return (
    <div
      className={`flipbook-turning-sheet ${
        isNext ? "flipbook-turn-next" : "flipbook-turn-previous"
      }`}
      onAnimationEnd={onDone}
    >
      <div className="flipbook-sheet-face flipbook-sheet-front">
        <PagePane page={frontPage} side={isNext ? "right" : "left"} />
      </div>
      <div className="flipbook-sheet-face flipbook-sheet-back">
        <PagePane page={backPage} side={isNext ? "left" : "right"} />
      </div>
      <div className="flipbook-sheet-gloss" />
    </div>
  );
};

const BlogFlipBookUI = ({ pages }: BlogFlipBookUIProps) => {
  const [currentSpread, setCurrentSpread] = useState(0);
  const [turn, setTurn] = useState<TurnState | null>(null);

  const sourcePages = pages?.length ? pages : dummyPages;

  const bookPages = useMemo<FlipBookPageType[]>(() => {
    if (sourcePages.length % 2 === 0) return sourcePages;
    return [...sourcePages, { id: "blank", image: "", title: "" }];
  }, [sourcePages]);

  const maxSpread = Math.max(0, bookPages.length - 2);
  const displaySpread = turn?.from ?? currentSpread;
  const pendingSpread = turn?.to ?? currentSpread;
  const spreadNumber = pendingSpread / 2 + 1;
  const totalSpreads = bookPages.length / 2;

  const completeTurn = useCallback(() => {
    setCurrentSpread((activeSpread) => turn?.to ?? activeSpread);
    setTurn(null);
  }, [turn]);

  const startTurn = useCallback(
    (direction: TurnDirection) => {
      if (turn) return;

      setCurrentSpread((from) => {
        const to =
          direction === "next"
            ? Math.min(from + 2, maxSpread)
            : Math.max(from - 2, 0);

        if (to !== from) {
          setTurn({ direction, from, to });
        }

        return from;
      });
    },
    [maxSpread, turn],
  );

  const goNext = useCallback(() => startTurn("next"), [startTurn]);
  const goPrevious = useCallback(() => startTurn("previous"), [startTurn]);

  const goToPage = useCallback(
    (pageIndex: number) => {
      if (turn) return;

      const nextSpread = Math.max(
        0,
        Math.min(normalizeSpread(pageIndex), maxSpread),
      );

      if (Math.abs(nextSpread - currentSpread) === 2) {
        setTurn({
          direction: nextSpread > currentSpread ? "next" : "previous",
          from: currentSpread,
          to: nextSpread,
        });
        return;
      }

      setCurrentSpread(nextSpread);
    },
    [currentSpread, maxSpread, turn],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrevious();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrevious]);

  const leftPage =
    turn?.direction === "previous"
      ? bookPages[turn.to]
      : bookPages[displaySpread];
  const rightPage =
    turn?.direction === "next"
      ? bookPages[turn.to + 1]
      : bookPages[displaySpread + 1];

  // Build the caption label to match reference: "Cover · spread 1 of N"
  // or "Artworks 1–2 · spread 2 of N"
  const captionLabel = (() => {
    if (pendingSpread === 0) {
      return `Cover\u00a0· spread 1\u00a0of\u00a0${totalSpreads}`;
    }
    const isEnd = pendingSpread >= maxSpread;
    const leftNum = pendingSpread + 1;
    const rightNum = pendingSpread + 2;
    const prefix = isEnd ? "End" : `Artworks\u00a0${leftNum}\u2013${rightNum}`;
    return `${prefix}\u00a0\u00b7 spread\u00a0${spreadNumber}\u00a0of\u00a0${totalSpreads}`;
  })();

  return (
    <div className="flipbook-profile">
      {/* NO header — reference design has none */}

      <main className="flipbook-stage" aria-live="polite">
        <div className="flipbook-book" aria-label="Artwork flipbook">
          <div className="flipbook-stack flipbook-stack-left" />
          <div className="flipbook-stack flipbook-stack-right" />

          <div className="flipbook-spread">
            <PagePane page={leftPage} side="left" />
            <PagePane page={rightPage} side="right" />
            <div className="flipbook-center-shadow" />
          </div>

          {turn && (
            <TurningSheet pages={bookPages} turn={turn} onDone={completeTurn} />
          )}
        </div>
      </main>

      <footer className="flipbook-footer">
        <div className="flipbook-controls">
          <button
            type="button"
            onClick={goPrevious}
            disabled={currentSpread === 0 || Boolean(turn)}
          >
            &larr; Prev
          </button>

          <div className="flipbook-caption">{captionLabel}</div>

          <button
            type="button"
            onClick={goNext}
            disabled={currentSpread >= maxSpread || Boolean(turn)}
          >
            Next &rarr;
          </button>
        </div>

        <div className="flipbook-thumbnails">
          <FlipBookThumbnailBar
            pages={bookPages}
            currentSpread={pendingSpread}
            onSelect={goToPage}
          />
        </div>

        <p className="flipbook-help">
          Click any page half to upload artwork <span>&middot;</span> Arrow keys
          to flip
        </p>
        <p className="flipbook-signature">Artwork by Hachimi</p>
      </footer>
    </div>
  );
};

export default BlogFlipBookUI;
