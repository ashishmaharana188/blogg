import type { BloggItem } from "../../../../../types/pageTypes";

export type FlipBookPageType = {
  id: string;
  pageKind: "overview" | "detail-cover" | "detail-content" | "blank";
  author: string;
  title: string;
  subtitle: string;
  tags: string[];
  content: any[];
  blogg?: BloggItem;
  pageNumber?: number;
  totalPages?: number;
  selectable?: boolean;
};

export type BlogFlipBookUIProps = {
  onEditBlogg?: (blogg: BloggItem) => void;
};

export type FlipBookPageProps = {
  page: FlipBookPageType;
  side: "left" | "right";
};

export type FlipBookDeckProps = {
  pages: FlipBookPageType[];
  currentSpread: number;
};

export type FlipBookThumbnailBarProps = {
  pages: FlipBookPageType[];
  currentSpread: number;
  onSelect: (pageIndex: number) => void;
};
