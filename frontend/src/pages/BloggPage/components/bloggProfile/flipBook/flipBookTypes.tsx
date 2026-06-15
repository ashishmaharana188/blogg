export type FlipBookPageType = {
  id: string;
  image: string;
  title?: string;
};

export type BlogFlipBookUIProps = {
  pages?: FlipBookPageType[];
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
