import "./copyrightNotice.css";

type Props = {
  enabled?: boolean;
  holder?: string | null;
  author?: string | null;
  createdAt?: string | Date | null;
  className?: string;
};

/** Quiet attribution footer, shown only when the note owner enables it. */
export default function CopyrightNotice({ enabled, holder, author, createdAt, className = "" }: Props) {
  if (!enabled) return null;
  const owner = (holder || author || "").replace(/\s+/g, " ").trim();
  if (!owner) return null;
  const parsedDate = createdAt ? new Date(createdAt) : new Date();
  const year = Number.isFinite(parsedDate.getTime()) ? parsedDate.getFullYear() : new Date().getFullYear();
  return <p className={`blogg-copyright-notice ${className}`.trim()}>{`© ${year} ${owner}. All rights reserved.`}</p>;
}
