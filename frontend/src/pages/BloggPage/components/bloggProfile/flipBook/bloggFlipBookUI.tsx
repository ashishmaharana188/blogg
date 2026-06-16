import React, { useEffect, useMemo, useRef, useState } from "react";
import HTMLFlipBook from "react-pageflip";

import FlipBookThumbnailBar from "./flipBookThumbnailBar";
import { dummyPages } from "./flipBookDummyData";
import type { BlogFlipBookUIProps, FlipBookPageType } from "./flipBookTypes";

// 1. THE REFINED PAGE COMPONENT (Edge-to-edge full bleed imagery)
const Page = React.forwardRef<
  HTMLDivElement,
  { page: FlipBookPageType; index: number; isLeft: boolean }
>(({ page, index, isLeft }, ref) => {
  return (
    <div
      ref={ref}
      className="relative bg-[#111] overflow-hidden"
      style={{
        // Adds the subtle dividing line exactly at the center fold
        borderRight: isLeft ? "1px solid rgba(0,0,0,0.4)" : "none",
        borderLeft: !isLeft ? "1px solid rgba(255,255,255,0.05)" : "none",
      }}
    >
      {/* The Deep Gutter Shadow: Anchored perfectly to the center fold */}
      <div
        className={`absolute top-0 bottom-0 w-12 sm:w-20 pointer-events-none z-20 ${
          isLeft
            ? "right-0 bg-gradient-to-l from-black/60 via-black/10 to-transparent"
            : "left-0 bg-gradient-to-r from-black/60 via-black/10 to-transparent"
        }`}
      />

      {/* Edge-to-Edge Artwork Container */}
      {page.image ? (
        <img
          src={page.image}
          alt={page.title || `Page ${index}`}
          className="w-full h-full object-cover"
          draggable="false"
        />
      ) : (
        <div className="w-full h-full bg-[#1a1a1a]" />
      )}
    </div>
  );
});

const BlogFlipBookUI = ({ pages }: BlogFlipBookUIProps) => {
  const bookRef = useRef<any>(null);
  const [currentSpread, setCurrentSpread] = useState(0);

  const sourcePages = pages?.length ? pages : dummyPages;

  const bookPages = useMemo<FlipBookPageType[]>(() => {
    if (sourcePages.length % 2 === 0) return sourcePages;
    return [...sourcePages, { id: "blank", image: "", title: "" }];
  }, [sourcePages]);

  const maxSpread = Math.max(0, bookPages.length - 2);

  const goNext = () => bookRef.current?.pageFlip().flipNext();
  const goPrevious = () => bookRef.current?.pageFlip().flipPrev();
  const goToPage = (pageIndex: number) =>
    bookRef.current?.pageFlip().turnToPage(pageIndex);

  const onFlip = (e: any) => {
    setCurrentSpread(e.data - (e.data % 2));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrevious();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const spreadNumber = currentSpread / 2 + 1;
  const totalSpreads = bookPages.length / 2;

  return (
    // Outer Wrapper: Locks strictly to 100% of available height.
    <div className="w-full h-full flex flex-col items-center bg-[#0a0a0a] overflow-hidden select-none font-sans">
      {/* HEADER SECTION */}
      <div className="w-full shrink-0 pt-6 sm:pt-8 pb-2 text-center z-10">
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-wide">
          FlipBook Profile
        </h1>
        <p className="mt-2 text-sm text-white/50 font-medium tracking-wide">
          Spread {spreadNumber} / {totalSpreads}
        </p>
      </div>

      {/* FLIPBOOK ENGINE SECTION (Fluidly fills exact remaining space) */}
      <div className="flex-1 w-full min-h-0 flex items-center justify-center py-4 relative z-0">
        {/* The Drop Shadow Wrapper: Casts a shadow behind the entire book */}
        <div className="relative shadow-[0_20px_50px_rgba(0,0,0,0.9)] rounded-sm">
          <HTMLFlipBook
            width={450}
            height={600}
            size="stretch"
            minWidth={280}
            maxWidth={600}
            minHeight={350}
            maxHeight={800}
            maxShadowOpacity={0.7}
            showCover={false}
            mobileScrollSupport={true}
            onFlip={onFlip}
            className="flipbook-engine"
            ref={bookRef}
          >
            {bookPages.map((page, index) => (
              <Page
                key={page.id || index}
                index={index}
                page={page}
                isLeft={index % 2 === 0}
              />
            ))}
          </HTMLFlipBook>
        </div>
      </div>

      {/* FOOTER SECTION */}
      <div className="w-full shrink-0 flex flex-col items-center pb-6 sm:pb-8 pt-2 z-10">
        {/* Navigation Buttons */}
        <div className="flex items-center justify-center gap-4 sm:gap-8 text-white mb-6 w-full max-w-2xl px-4">
          <button
            onClick={goPrevious}
            disabled={currentSpread === 0}
            className="rounded border border-white/20 px-4 sm:px-6 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-20"
          >
            &larr; Prev
          </button>

          <div className="text-center text-sm text-white/60 min-w-[150px] sm:min-w-[200px]">
            {currentSpread === 0
              ? "Cover"
              : `Artworks ${currentSpread + 1}–${currentSpread + 2}`}
            <span className="hidden sm:inline">
              {" "}
              &middot; Spread {spreadNumber} of {totalSpreads}
            </span>
          </div>

          <button
            onClick={goNext}
            disabled={currentSpread >= maxSpread}
            className="rounded border border-white/20 px-4 sm:px-6 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-20"
          >
            Next &rarr;
          </button>
        </div>

        {/* Thumbnail Bar */}
        <div className="w-full max-w-5xl px-4">
          <FlipBookThumbnailBar
            pages={bookPages}
            currentSpread={currentSpread}
            onSelect={(pageIndex) => {
              goToPage(pageIndex - (pageIndex % 2));
            }}
          />
        </div>

        {/* Signature */}
        <p className="mt-5 text-[10px] sm:text-xs text-white/30 tracking-widest uppercase">
          Artwork by Hachimi
        </p>
      </div>
    </div>
  );
};

export default BlogFlipBookUI;
