import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReadOnlyBloggContent } from "./readOnlyBloggContent";
import { fetchAllBloggsRequest } from "../../../services/flipBookService";
import FlipBookThumbnailBar from "./flipBookThumbnailBar";
import "./flipBook.css";
import type { FlipBookPageType } from "./flipBookTypes";

type TurnDirection = "next" | "previous";

type ActiveTurn = {
  id: number;
  direction: TurnDirection;
  from: number;
  to: number;
  isRapid: boolean;
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
      {isBlank ? (
        <div className="flipbook-page-blank" />
      ) : (
        <div className="flipbook-page-content">
          <header className="flipbook-blogg-header">
            {page.author && (
              <p className="flipbook-blogg-author">{page.author}</p>
            )}

            <h1 className="flipbook-blogg-title">{page.title}</h1>

            {page.subtitle && (
              <p className="flipbook-blogg-subtitle">{page.subtitle}</p>
            )}

            {page.tags.length > 0 && (
              <div className="flipbook-blogg-tags">
                {page.tags.map((tag) => (
                  <span key={tag} className="flipbook-blogg-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          <ReadOnlyBloggContent key={page.id} content={page.content} />
        </div>
      )}
    </div>
  );
};

const TurningSheet = ({
  pages,
  turn,
  onDone,
}: {
  pages: FlipBookPageType[];
  turn: ActiveTurn;
  onDone: () => void;
}) => {
  const isNext = turn.direction === "next";

  const frontPage = pages[isNext ? turn.from + 1 : turn.from];
  const backPage = pages[isNext ? turn.to : turn.to + 1];

  return (
    <div
      className={`flipbook-turning-sheet ${
        isNext ? "flipbook-turn-next" : "flipbook-turn-previous"
      } ${turn.isRapid ? "flipbook-rapid" : ""}`}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        onDone();
      }}
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

const BlogFlipBookUI = () => {
  const [pages, setPages] = useState<FlipBookPageType[]>([]);
  const [settledSpread, setSettledSpread] = useState(0);
  const [activeTurns, setActiveTurns] = useState<ActiveTurn[]>([]);

  useEffect(() => {
    const loadFlipBookPages = async () => {
      try {
        const bloggs = await fetchAllBloggsRequest();

        const flipBookPages: FlipBookPageType[] = bloggs.map((blogg: any) => ({
          id: blogg._id,
          author: blogg.author ?? "",
          title: blogg.title ?? "",
          subtitle: blogg.subtitle ?? "",
          tags: blogg.tags ?? [],
          content: blogg.content ?? [],
        }));

        setPages(flipBookPages);
      } catch (error) {
        console.error("Could not load flipbook pages:", error);
        setPages([]);
      }
    };

    loadFlipBookPages();
  }, []);

  const turnIdRef = useRef(0);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rapidIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sourcePages = pages;

  const bookPages = useMemo<FlipBookPageType[]>(() => {
    if (sourcePages.length % 2 === 0) return sourcePages;
    return [
      ...sourcePages,
      {
        id: "blank",
        author: "",
        title: "",
        subtitle: "",
        tags: [],
        content: [],
      },
    ];
  }, [sourcePages]);

  const maxSpread = Math.max(0, bookPages.length - 2);

  // 1. Math-Armored logical spread. Completely immune to out-of-order execution
  const currentLogicalSpread = useMemo(() => {
    if (activeTurns.length === 0) return settledSpread;
    const direction = activeTurns[0].direction;
    const targets = activeTurns.map((t) => t.to);
    return direction === "next"
      ? Math.max(settledSpread, ...targets)
      : Math.min(settledSpread, ...targets);
  }, [activeTurns, settledSpread]);

  const completeTurn = useCallback(
    (id: number, targetSpread: number, direction: TurnDirection) => {
      // 2. State Armor: Ensure settled pages NEVER mathematically bounce backward
      setSettledSpread((prev) => {
        if (direction === "next") return Math.max(prev, targetSpread);
        if (direction === "previous") return Math.min(prev, targetSpread);
        return targetSpread;
      });
      setActiveTurns((prev) => prev.filter((t) => t.id !== id));
    },
    [],
  );

  const startTurn = useCallback(
    (direction: TurnDirection, isRapid = false) => {
      setActiveTurns((prev) => {
        if (prev.length > 0 && prev[0].direction !== direction) return prev;

        let lastLogical = settledSpread;
        if (prev.length > 0) {
          const targets = prev.map((t) => t.to);
          lastLogical =
            direction === "next"
              ? Math.max(settledSpread, ...targets)
              : Math.min(settledSpread, ...targets);
        }

        const to =
          direction === "next"
            ? Math.min(lastLogical + 2, maxSpread)
            : Math.max(lastLogical - 2, 0);

        if (to === lastLogical) return prev;

        const newTurn: ActiveTurn = {
          id: turnIdRef.current++,
          direction,
          from: lastLogical,
          to,
          isRapid,
        };

        return [...prev, newTurn];
      });
    },
    [maxSpread, settledSpread],
  );

  const stopHold = useCallback(() => {
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    if (rapidIntervalRef.current) clearInterval(rapidIntervalRef.current);
    holdTimeoutRef.current = null;
    rapidIntervalRef.current = null;
  }, []);

  // 3. The Boundary Watchdog: Kills interval zombies immediately
  useEffect(() => {
    if (currentLogicalSpread <= 0 || currentLogicalSpread >= maxSpread) {
      stopHold();
    }
  }, [currentLogicalSpread, maxSpread, stopHold]);

  const startHold = useCallback(
    (direction: TurnDirection) => {
      stopHold();
      startTurn(direction, false);

      holdTimeoutRef.current = setTimeout(() => {
        rapidIntervalRef.current = setInterval(() => {
          startTurn(direction, true);
        }, 120);
      }, 300);
    },
    [startTurn, stopHold],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, direction: TurnDirection) => {
      if (e.button !== 0) return;
      startHold(direction);
    },
    [startHold],
  );

  const goToPage = useCallback(
    (pageIndex: number) => {
      if (activeTurns.length > 0) return;
      stopHold();

      const nextSpread = Math.max(
        0,
        Math.min(normalizeSpread(pageIndex), maxSpread),
      );

      if (nextSpread === settledSpread) return;

      if (Math.abs(nextSpread - settledSpread) === 2) {
        startTurn(nextSpread > settledSpread ? "next" : "previous", false);
        return;
      }

      setSettledSpread(nextSpread);
      setActiveTurns([]);
    },
    [activeTurns.length, maxSpread, settledSpread, startTurn, stopHold],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 4. Keyboard Emulation: Blocks the 30ms native OS spam
      if (event.repeat) return;
      if (event.key === "ArrowRight") startHold("next");
      if (event.key === "ArrowLeft") startHold("previous");
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        stopHold();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startHold, stopHold]);

  let leftIndex = settledSpread;
  let rightIndex = settledSpread + 1;

  if (activeTurns.length > 0) {
    const currentDir = activeTurns[0].direction;
    if (currentDir === "next") {
      leftIndex = settledSpread;
      rightIndex = currentLogicalSpread + 1;
    } else {
      leftIndex = currentLogicalSpread;
      rightIndex = settledSpread + 1;
    }
  }

  const leftPage = bookPages[leftIndex];
  const rightPage = bookPages[rightIndex];

  const spreadNumber = currentLogicalSpread / 2 + 1;
  const totalSpreads = bookPages.length / 2;

  const disablePrev =
    currentLogicalSpread === 0 ||
    (activeTurns.length > 0 && activeTurns[0].direction === "next");
  const disableNext =
    currentLogicalSpread >= maxSpread ||
    (activeTurns.length > 0 && activeTurns[0].direction === "previous");

  const captionLabel = (() => {
    if (currentLogicalSpread === 0) {
      return `Cover\u00a0· spread 1\u00a0of\u00a0${totalSpreads}`;
    }
    const isEnd = currentLogicalSpread >= maxSpread;
    const leftNum = currentLogicalSpread + 1;
    const rightNum = currentLogicalSpread + 2;
    //const prefix = isEnd ? "End" : `Bloggs\u00a0${leftNum}\u2013${rightNum}`;
    const prefix = isEnd ? "End" : `Bloggs`;
    return `${prefix}\u00a0\u00b7 spread\u00a0${spreadNumber}\u00a0of\u00a0${totalSpreads}`;
  })();

  return (
    <div className="flipbook-profile">
      <main className="flipbook-stage" aria-live="polite">
        <div className="flipbook-book" aria-label="Artwork flipbook">
          <div className="flipbook-stack flipbook-stack-left" />
          <div className="flipbook-stack flipbook-stack-right" />

          <div className="flipbook-spread">
            <PagePane page={leftPage} side="left" />
            <PagePane page={rightPage} side="right" />
            <div
              className={`flipbook-center-shadow ${
                activeTurns.length > 0 ? "flipbook-center-shadow-active" : ""
              }`}
            />
          </div>

          {activeTurns.map((turn) => (
            <TurningSheet
              key={turn.id}
              pages={bookPages}
              turn={turn}
              onDone={() => completeTurn(turn.id, turn.to, turn.direction)}
            />
          ))}
        </div>
      </main>

      <footer className="flipbook-footer">
        <div className="flipbook-controls">
          <button
            type="button"
            onPointerDown={(e) => handlePointerDown(e, "previous")}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            onContextMenu={stopHold}
            disabled={disablePrev}
          >
            &larr; Prev
          </button>

          <div className="flipbook-caption">{captionLabel}</div>

          <button
            type="button"
            onPointerDown={(e) => handlePointerDown(e, "next")}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            onContextMenu={stopHold}
            disabled={disableNext}
          >
            Next &rarr;
          </button>
        </div>

        <div className="flipbook-thumbnails">
          <FlipBookThumbnailBar
            pages={bookPages}
            currentSpread={currentLogicalSpread}
            onSelect={goToPage}
          />
        </div>
      </footer>
    </div>
  );
};

export default BlogFlipBookUI;
