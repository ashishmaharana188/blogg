import "./copyrightNotice.css";

type Props = {
  enabled?: boolean;
  holder?: string | null;
  author?: string | null;
  createdAt?: string | Date | null;
  className?: string;
};

/**
 * Quiet per-note footer. Never infers ownership from the author field:
 * when no rights holder is explicitly named, show the general legal declaration.
 */
export default function CopyrightNotice({ enabled, holder, createdAt, className = "" }: Props) {
  if (!enabled) return null;
  const owner = (holder || "").replace(/\s+/g, " ").trim();
  const parsedDate = createdAt ? new Date(createdAt) : new Date();
  const year = Number.isFinite(parsedDate.getTime()) ? parsedDate.getFullYear() : new Date().getFullYear();
  const declaration = "Section 17 ordinarily makes the author the first owner, subject to exceptions. Section 57 preserves the author's right to claim authorship. This footer is attribution, not a transfer of rights. Section 17 · Section 57.";
  const text = owner ? `© ${year} ${owner}. All rights reserved.` : declaration;
  return <p className={`blogg-copyright-notice ${className}`.trim()}>{text}</p>;
}
