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
import FlipBookThumbnailBar from "./flipBookThumbnailBar";
import "./flipBook.css";
import { ReadOnlyBloggContent } from "./readOnlyBloggContent";
import type { BlogFlipBookUIProps, FlipBookPageType } from "./flipBookTypes";

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

const getBlockText = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(getBlockText).join(" ");
  if (typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return [record.text, record.content, record.children]
    .map(getBlockText)
    .join(" ")
    .trim();
};

const getBloggPreview = (blogg: BloggItem) => {
  const contentText = getBlockText(blogg.content).replace(/\s+/g, " ").trim();
  return blogg.subtitle || contentText || "Open this blog to read it.";
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
    subtitle: getBloggPreview(blogg),
    tags: blogg.tags,
    content: [],
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
      role={canSelect ? "button" : undefined}
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
        <article className="flipbook-page-content flipbook-overview-page">
          <p className="flipbook-blogg-author">
            {page.author || "Unknown author"}
          </p>
          <h1 className="flipbook-blogg-title">{page.title}</h1>
          <p className="flipbook-blogg-subtitle">{page.subtitle}</p>
          {page.tags.length > 0 && (
            <div className="flipbook-blogg-tags">
              {page.tags.slice(0, 4).map((tag) => (
                <span key={tag} className="flipbook-blogg-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {canSelect && <p className="flipbook-open-hint">Click to open</p>}
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
            Page {page.pageNumber} of {page.totalPages}
          </p>
        </article>
      ) : (
        <article className="flipbook-page-content flipbook-detail-page">
          <ReadOnlyBloggContent key={page.id} content={page.content} />
          <p className="flipbook-page-count">
            Page {page.pageNumber} of {page.totalPages}
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
      <div className="flipbook-sheet-gloss" />
    </div>
  );
};

const BlogFlipBookUI = ({ onEditBlogg }: BlogFlipBookUIProps) => {
  const [bloggs, setBloggs] = useState<BloggItem[]>([]);
  const [selectedBlogg, setSelectedBlogg] = useState<BloggItem | null>(null);
  const [settledSpread, setSettledSpread] = useState(0);
  const [activeTurns, setActiveTurns] = useState<ActiveTurn[]>([]);

  const turnIdRef = useRef(0);
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
    setActiveTurns([]);
    setSettledSpread(0);
  }, [stopHold]);

  const handleSelectBlogg = useCallback(
    (blogg: BloggItem) => {
      resetTurns();
      setSelectedBlogg(blogg);
    },
    [resetTurns],
  );

  const handleBack = useCallback(() => {
    resetTurns();
    setSelectedBlogg(null);
  }, [resetTurns]);

  const handleEdit = useCallback(() => {
    if (!selectedBlogg) return;
    stopHold();
    onEditBlogg?.(selectedBlogg);
  }, [onEditBlogg, selectedBlogg, stopHold]);

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
      setSettledSpread((prev) => {
        if (direction === "next") return Math.max(prev, targetSpread);
        return Math.min(prev, targetSpread);
      });
      setActiveTurns((prev) => prev.filter((turn) => turn.id !== id));
    },
    [],
  );

  const startTurn = useCallback(
    (direction: TurnDirection, isRapid = false) => {
      setActiveTurns((prev) => {
        if (prev.length > 0 && prev[0].direction !== direction) return prev;

        let lastLogical = settledSpread;
        if (prev.length > 0) {
          const targets = prev.map((turn) => turn.to);
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

        return [
          ...prev,
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
    [maxSpread, settledSpread],
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

  return (
    <div className="flipbook-profile">
      <main className="flipbook-stage" aria-live="polite">
        <div className="flipbook-book" aria-label="Blog flipbook">
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
        {selectedBlogg && (
          <div className="flipbook-mode-actions">
            <button type="button" onClick={handleBack}>
              Back
            </button>
            <button type="button" onClick={handleEdit}>
              Edit
            </button>
          </div>
        )}

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
