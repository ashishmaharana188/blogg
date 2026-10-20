import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import type { BloggItem } from "../../../../../types/pageTypes";
import { fetchAllBloggsRequest } from "../../../services/flipBookService";
import { fetchStackAndGroup } from "../../../services/canvasViewService";
import FlipBookThumbnailBar from "./flipBookThumbnailBar";
import "./flipBook.css";
import "./flipBookSpine.css";
import { ReadOnlyBloggContent } from "./readOnlyBloggContent";
import type { BlogFlipBookUIProps, FlipBookPageType } from "./flipBookTypes";
import ShareBloggButton from "../../ShareBloggButton";

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
  onSelectBlogg?: (blogg: BloggItem) => void;
};

const BLOCKS_PER_DETAIL_PAGE = 4;

const normalizeSpread = (index: number) => index - (index % 2);

const blankPage = (): FlipBookPageType => ({
  id: "blank",
  pageKind: "blank",
  author: "",
  title: "",
  subtitle: "",
  tags: [],
  content: [],
});

const normalizeBlogg = (blogg: Partial<BloggItem> & { _id?: string }) =>
  ({
    ...blogg,
    _id: blogg._id ?? blogg.blogg_id ?? "",
    blogg_id: blogg.blogg_id ?? blogg._id ?? "",
    stack_id: blogg.stack_id ?? "",
    group_id: blogg.group_id ?? "",
    document_type: blogg.document_type ?? "note",
    author: blogg.author ?? "",
    title: blogg.title ?? "Untitled",
    subtitle: blogg.subtitle ?? "",
    tags: blogg.tags ?? [],
    content: Array.isArray(blogg.content) ? blogg.content : [],
    createdAt: blogg.createdAt ?? "",
    updatedAt: blogg.updatedAt ?? "",
  }) as BloggItem;

const chunkBlocks = (content: unknown[] = []) => {
  const blocks = content.length > 0 ? content : [];
  const chunks: unknown[][] = [];

  for (let index = 0; index < blocks.length; index += BLOCKS_PER_DETAIL_PAGE) {
    chunks.push(blocks.slice(index, index + BLOCKS_PER_DETAIL_PAGE));
  }

  return chunks.length > 0 ? chunks : [[]];
};

const createOverviewPages = (bloggs: BloggItem[]): FlipBookPageType[] => {
  if (bloggs.length === 0) {
    return [
      {
        id: "empty-overview",
        pageKind: "overview",
        author: "",
        title: "No blogs yet",
        subtitle: "Create a note to add it to the flipbook.",
        tags: [],
        content: [],
        selectable: false,
      },
    ];
  }

  return bloggs.map((blogg) => ({
    id: blogg.blogg_id || blogg._id,
    pageKind: "overview",
    author: blogg.author,
    title: blogg.title || "Untitled",
    // Keep the description in the metadata area and render the actual
    // BlockNote body separately below, instead of substituting one for another.
    subtitle: blogg.subtitle || "",
    tags: blogg.tags ?? [],
    content: Array.isArray(blogg.content) ? blogg.content : [],
    blogg,
    selectable: true,
  }));
};

const createDetailPages = (blogg: BloggItem): FlipBookPageType[] => {
  const chunks = chunkBlocks(blogg.content);
  const totalPages = chunks.length + 1;

  return [
    {
      id: `${blogg.blogg_id}-cover`,
      pageKind: "detail-cover",
      author: blogg.author,
      title: blogg.title || "Untitled",
      subtitle: blogg.subtitle,
      tags: blogg.tags,
      content: [],
      blogg,
      pageNumber: 1,
      totalPages,
    },
    ...chunks.map((content, index) => ({
      id: `${blogg.blogg_id}-page-${index + 1}`,
      pageKind: "detail-content" as const,
      author: blogg.author,
      title: blogg.title || "Untitled",
      subtitle: "",
      tags: [],
      content,
      blogg,
      pageNumber: index + 2,
      totalPages,
    })),
  ];
};

const PagePane = ({
  page,
  side,
  className = "",
  onSelectBlogg,
}: PagePaneProps) => {
  const isBlank = !page || page.pageKind === "blank";
  const canSelect =
    page?.pageKind === "overview" &&
    page.selectable !== false &&
    Boolean(page.blogg) &&
    Boolean(onSelectBlogg);

  const openBlogg = () => {
    if (canSelect && page?.blogg) {
      onSelectBlogg?.(page.blogg);
    }
  };

  return (
    <div
      className={`flipbook-page flipbook-page-${side} ${
        canSelect ? "flipbook-page-clickable" : ""
      } ${className}`}
      role={canSelect ? "group" : undefined}
      tabIndex={canSelect ? 0 : undefined}
      onClick={openBlogg}
      onKeyDown={(event) => {
        if (!canSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openBlogg();
        }
      }}
    >
      {isBlank ? (
        <div className="flipbook-page-blank" />
      ) : page.pageKind === "overview" ? (
        <article
          className="flipbook-page-content flipbook-overview-page"
          style={{ justifyContent: "flex-start" }}
        >
          <p className="flipbook-blogg-author">
            {page.author || "Unknown author"}
          </p>
          <h1 className="flipbook-blogg-title">{page.title}</h1>
          {page.subtitle && (
            <p className="flipbook-blogg-subtitle">{page.subtitle}</p>
          )}
          {page.tags.length > 0 && (
            <div className="flipbook-blogg-tags">
              {page.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="flipbook-blogg-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div
            className="flipbook-overview-body-preview scrollbar-none"
            aria-label={`${page.title} content preview`}
            // The preview has its own scroll area. Do not let a click inside it
            // bubble to the page-level open handler, otherwise the first scroll
            // interaction unexpectedly opens the note.
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              width: "100%",
              marginTop: "1rem",
              paddingTop: "0.75rem",
              borderTop: "1px solid #e5e7eb",
              textAlign: "left",
            }}
          >
            {page.content.length > 0 ? (
              <ReadOnlyBloggContent
                key={`overview-preview-${page.id}`}
                content={page.content}
              />
            ) : (
              <p style={{ color: "#9ca3af", fontStyle: "italic" }}>
                This note has no body content yet.
              </p>
            )}
          </div>

        </article>
      ) : page.pageKind === "detail-cover" ? (
        <article className="flipbook-page-content flipbook-detail-cover">
          <p className="flipbook-blogg-author">
            {page.author || "Unknown author"}
          </p>
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
          <p className="flipbook-page-count">
            {page.pageNumber}
          </p>
        </article>
      ) : (
        <article className="flipbook-page-content flipbook-detail-page">
          <ReadOnlyBloggContent key={page.id} content={page.content} />
          <p className="flipbook-page-count">
            {page.pageNumber}
          </p>
        </article>
      )}
    </div>
  );
};

const TurningSheet = ({
  pages,
  turn,
  onDone,
  stackOrder,
}: {
  pages: FlipBookPageType[];
  turn: ActiveTurn;
  onDone: () => void;
  stackOrder: number;
}) => {
  const isNext = turn.direction === "next";
  const frontPage = pages[isNext ? turn.from + 1 : turn.from];
  const backPage = pages[isNext ? turn.to : turn.to + 1];

  return (
    <div
      className={`flipbook-turning-sheet ${
        isNext ? "flipbook-turn-next" : "flipbook-turn-previous"
      } ${turn.isRapid ? "flipbook-rapid" : ""}`}
      style={{ zIndex: stackOrder }}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        onDone();
      }}
    >
      <div className="flipbook-sheet-face flipbook-sheet-front">
        <PagePane page={frontPage} side={isNext ? "right" : "left"} />
      </div>
      <div className="flipbook-sheet-face flipbook-sheet-back">
        <PagePane page={backPage} side={isNext ? "left" : "right"} />
      </div>
    </div>
  );
};

const BlogFlipBookUI = ({
  onEditBlogg,
  initialBloggId,
  onOpenBlogg,
  onBackFromBlogg,
  onOpenInReader,
}: BlogFlipBookUIProps) => {
  const [bloggs, setBloggs] = useState<BloggItem[]>([]);
  const [canvasStacks, setCanvasStacks] = useState<any[]>([]);
  const [canvasGroups, setCanvasGroups] = useState<any[]>([]);
  const [selectedBlogg, setSelectedBlogg] = useState<BloggItem | null>(null);
  const [settledSpread, setSettledSpread] = useState(0);
  const [activeTurns, setActiveTurns] = useState<ActiveTurn[]>([]);

  const turnIdRef = useRef(0);
  // A ref keeps held-key page turns in sync even though the interval callback
  // outlives React renders.
  const settledSpreadRef = useRef(0);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rapidIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const loadFlipBookPages = async () => {
      try {
        const result = await fetchAllBloggsRequest();
        setBloggs(result.map((blogg: Partial<BloggItem>) => normalizeBlogg(blogg)));
      } catch (error) {
        console.error("Could not load flipbook pages:", error);
        setBloggs([]);
      }
    };

    loadFlipBookPages();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStackAndGroup()
      .then((data) => {
        if (cancelled) return;
        setCanvasStacks(Array.isArray(data?.stacks) ? data.stacks : []);
        setCanvasGroups(Array.isArray(data?.groups) ? data.groups : []);
      })
      .catch((error) => console.error("Could not load folder names for sharing:", error));
    return () => { cancelled = true; };
  }, []);

  // A /blog/:bloggId link opens the matching note directly. When the id is
  // removed (Back), return to the overview spread.
  useEffect(() => {
    if (!initialBloggId) {
      setSelectedBlogg(null);
      return;
    }
    if (bloggs.length === 0) return;
    const matchedBlogg = bloggs.find(
      (blogg) => blogg.blogg_id === initialBloggId || blogg._id === initialBloggId,
    );
    setSelectedBlogg(matchedBlogg ?? null);
  }, [bloggs, initialBloggId]);

  const sourcePages = useMemo(
    () =>
      selectedBlogg
        ? createDetailPages(selectedBlogg)
        : createOverviewPages(bloggs),
    [bloggs, selectedBlogg],
  );

  const bookPages = useMemo<FlipBookPageType[]>(() => {
    if (sourcePages.length % 2 === 0) return sourcePages;
    return [...sourcePages, blankPage()];
  }, [sourcePages]);

  const maxSpread = Math.max(0, bookPages.length - 2);

  const stopHold = useCallback(() => {
    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    if (rapidIntervalRef.current) clearInterval(rapidIntervalRef.current);
    holdTimeoutRef.current = null;
    rapidIntervalRef.current = null;
  }, []);

  const resetTurns = useCallback(() => {
    stopHold();
    settledSpreadRef.current = 0;
    setActiveTurns([]);
    setSettledSpread(0);
  }, [stopHold]);

  const handleSelectBlogg = useCallback(
    (blogg: BloggItem) => {
      resetTurns();
      setSelectedBlogg(blogg);
      onOpenBlogg?.(blogg);
    },
    [onOpenBlogg, resetTurns],
  );

  const handleBack = useCallback(() => {
    resetTurns();
    setSelectedBlogg(null);
    onBackFromBlogg?.();
  }, [onBackFromBlogg, resetTurns]);

  const handleEdit = useCallback(() => {
    if (!selectedBlogg) return;
    stopHold();
    onEditBlogg?.(selectedBlogg);
  }, [onEditBlogg, selectedBlogg, stopHold]);

  const handleOpenInReader = useCallback(() => {
    if (!selectedBlogg) return;
    stopHold();
    onOpenInReader?.(selectedBlogg);
  }, [onOpenInReader, selectedBlogg, stopHold]);

  const currentLogicalSpread = useMemo(() => {
    if (activeTurns.length === 0) return settledSpread;
    const direction = activeTurns[0].direction;
    const targets = activeTurns.map((turn) => turn.to);
    return direction === "next"
      ? Math.max(settledSpread, ...targets)
      : Math.min(settledSpread, ...targets);
  }, [activeTurns, settledSpread]);

  const completeTurn = useCallback(
    (id: number, targetSpread: number, direction: TurnDirection) => {
      // Keep the settled position moving in the same direction as the active
      // stack. Older overlapping sheets must never pull the book backwards.
      const nextSettled =
        direction === "next"
          ? Math.max(settledSpreadRef.current, targetSpread)
          : Math.min(settledSpreadRef.current, targetSpread);
      settledSpreadRef.current = nextSettled;
      setSettledSpread((previous) =>
        direction === "next"
          ? Math.max(previous, targetSpread)
          : Math.min(previous, targetSpread),
      );
      setActiveTurns((previous) => previous.filter((turn) => turn.id !== id));
    },
    [],
  );

  const startTurn = useCallback(
    (direction: TurnDirection, isRapid = false) => {
      setActiveTurns((previous) => {
        // During a held gesture, start the next leaf before earlier sheets
        // finish. This restores the rapid page-stack motion instead of waiting
        // for every 620 ms animation to settle before advancing again.
        if (previous.length > 0 && previous[0].direction !== direction) {
          return previous;
        }

        let lastLogical = settledSpreadRef.current;
        if (previous.length > 0) {
          const targets = previous.map((turn) => turn.to);
          lastLogical = direction === "next"
            ? Math.max(lastLogical, ...targets)
            : Math.min(lastLogical, ...targets);
        }

        const to = direction === "next"
          ? Math.min(lastLogical + 2, maxSpread)
          : Math.max(lastLogical - 2, 0);

        if (to === lastLogical) return previous;

        return [
          ...previous,
          {
            id: turnIdRef.current++,
            direction,
            from: lastLogical,
            to,
            isRapid,
          },
        ];
      });
    },
    [maxSpread],
  );

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
    (event: PointerEvent<HTMLButtonElement>, direction: TurnDirection) => {
      if (event.button !== 0) return;
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

      settledSpreadRef.current = nextSpread;
      setSettledSpread(nextSpread);
      setActiveTurns([]);
    },
    [activeTurns.length, maxSpread, settledSpread, startTurn, stopHold],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "ArrowRight") startHold("next");
      if (event.key === "ArrowLeft") startHold("previous");
      if (event.key === "Escape" && selectedBlogg) handleBack();
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
  }, [handleBack, selectedBlogg, startHold, stopHold]);

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

  const captionLabel = selectedBlogg
    ? `${selectedBlogg.title || "Blog"} · page ${currentLogicalSpread + 1}-${Math.min(
        currentLogicalSpread + 2,
        sourcePages.length,
      )} of ${sourcePages.length}`
    : `Bloggs · spread ${spreadNumber} of ${totalSpreads}`;

  const selectedGroup = selectedBlogg
    ? canvasGroups.find((group) => group.group_id === selectedBlogg.group_id)
    : undefined;
  const selectedStack = selectedBlogg
    ? canvasStacks.find((stack) => stack.stack_id === selectedBlogg.stack_id) ||
      canvasStacks.find((stack) => stack.stack_id === selectedGroup?.stack_id)
    : undefined;

  return (
    <div className="flipbook-profile">
      <main className="flipbook-stage" aria-live="polite">
        <div
          className={`flipbook-book ${activeTurns.length > 0 ? "flipbook-book-turning" : ""}`}
          aria-label="Blog flipbook"
        >
          <div className="flipbook-stack flipbook-stack-left" />
          <div className="flipbook-stack flipbook-stack-right" />

          <div className="flipbook-spread">
            <PagePane
              page={leftPage}
              side="left"
              onSelectBlogg={selectedBlogg ? undefined : handleSelectBlogg}
            />
            <PagePane
              page={rightPage}
              side="right"
              onSelectBlogg={selectedBlogg ? undefined : handleSelectBlogg}
            />
            <div
              className={`flipbook-center-shadow ${
                activeTurns.length > 0 ? "flipbook-center-shadow-active" : ""
              }`}
            />
            {activeTurns.length === 0 && (
              <div className="flipbook-spiral-spine" aria-hidden="true">
                {Array.from({ length: 20 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            )}
          </div>

          {activeTurns.map((turn, index) => (
            <TurningSheet
              key={turn.id}
              pages={bookPages}
              turn={turn}
              // Older sheets stay above the newer ones, preserving the rapid
              // stacked-leaf effect while multiple turns animate at once.
              stackOrder={100 - index}
              onDone={() => completeTurn(turn.id, turn.to, turn.direction)}
            />
          ))}
        </div>
      </main>

      <footer className="flipbook-footer">
        <div className="flipbook-controls">
          <button
            type="button"
            onPointerDown={(event) => handlePointerDown(event, "previous")}
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
            onPointerDown={(event) => handlePointerDown(event, "next")}
            onPointerUp={stopHold}
            onPointerLeave={stopHold}
            onPointerCancel={stopHold}
            onContextMenu={stopHold}
            disabled={disableNext}
          >
            Next &rarr;
          </button>
        </div>

        {selectedBlogg ? (
          <div className="flipbook-mode-actions" aria-label="Opened note actions">
            <button type="button" onClick={handleBack}>Back</button>
            <button type="button" onClick={handleOpenInReader}>Open in Note View</button>
            {onEditBlogg && <button type="button" onClick={handleEdit}>Edit</button>}
            <ShareBloggButton
              blogg={selectedBlogg}
              stackName={selectedStack?.stack_name || "Unsorted stack"}
              groupName={selectedGroup?.group_name || "Others"}
            />
          </div>
        ) : (
          <div className="flipbook-thumbnails">
            <FlipBookThumbnailBar
              pages={bookPages}
              currentSpread={currentLogicalSpread}
              onSelect={goToPage}
            />
          </div>
        )}
      </footer>
    </div>
  );
};

export default BlogFlipBookUI;
