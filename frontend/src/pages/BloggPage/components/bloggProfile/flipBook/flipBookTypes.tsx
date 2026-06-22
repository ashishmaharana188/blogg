export type FlipBookPageType = {
  id: string;
  author: string;
  title: string;
  subtitle: string;
  tags: string[];
  content: any[];
};

export type BlogFlipBookUIProps = {};

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
