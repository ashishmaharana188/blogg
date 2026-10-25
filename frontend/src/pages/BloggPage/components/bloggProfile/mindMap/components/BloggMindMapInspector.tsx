import { useMemo } from "react";
import type { MindMapBlogg } from "../../../../services/bloggReferencesService";

type SelectedNode = Record<string, any> | null;
type Props = {
  selectedNode: SelectedNode;
  bloggs: MindMapBlogg[];
  canEdit: boolean;
  onClose: () => void;
  onOpenBlogg: (bloggId: string, edit?: boolean) => void;
};

const CloseIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
  >
    <path d="m5 5 10 10M15 5 5 15" />
  </svg>
);
const OpenIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    className="mt-0.5 h-4 w-4 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M7.5 5H5.25A1.25 1.25 0 0 0 4 6.25v8.5A1.25 1.25 0 0 0 5.25 16h8.5A1.25 1.25 0 0 0 15 14.75V12.5" />
    <path d="M10 4h6v6M16 4 8.5 11.5" />
  </svg>
);
const LinkIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 20 20"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <path
      d="M8 12 12.5 7.5M6.5 13.5l-1 1a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0M13.5 6.5l1-1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0"
      transform="translate(.5 .5)"
    />
  </svg>
);
export default function BloggMindMapInspector({
  selectedNode,
  bloggs,
  canEdit,
  onClose,
  onOpenBlogg,
}: Props) {
  const isBlog =
    selectedNode?.group === "notes" && Boolean(selectedNode?.isSubnode);
  const isGroup = selectedNode?.group === "notes" && !selectedNode?.isSubnode;
  const title = selectedNode?.label || selectedNode?.title || "Untitled";
  const selectedBloggId = isBlog ? String(selectedNode?.id || "") : "";

  const outgoingReferences = useMemo(() => {
    if (!selectedBloggId) return [];
    const selected = bloggs.find((blogg) => blogg.blogg_id === selectedBloggId);
    return (selected?.references || []).map((reference) => ({
      ...reference,
      target: bloggs.find(
        (blogg) => blogg.blogg_id === reference.target_blogg_id,
      ),
    }));
  }, [bloggs, selectedBloggId]);

  const incomingReferences = useMemo(() => {
    if (!selectedBloggId) return [];
    return bloggs.flatMap((source) =>
      (source.references || [])
        .filter((reference) => reference.target_blogg_id === selectedBloggId)
        .map((reference) => ({ source, reference })),
    );
  }, [bloggs, selectedBloggId]);

  const openReferencedBlog = (bloggId: string) => {
    if (!bloggId) return;
    window.dispatchEvent(
      new CustomEvent("MINDMAP_SELECT_NODE", { detail: { nodeId: bloggId } }),
    );
  };

  if (!selectedNode) return null;

  const nodeType = isBlog
    ? "Blog"
    : isGroup
      ? "Folder"
      : selectedNode.group === "stacks"
        ? "Stack"
        : "Node";
  const stackId =
    selectedNode.group === "stacks"
      ? String(selectedNode.id || "")
      : String(selectedNode.stackId || "");

  return (
    <div className="absolute left-3 right-3 top-16 z-40 flex max-h-[calc(100%-5rem)] flex-col overflow-y-auto rounded-lg border border-gray-300 bg-surface/95 shadow-2xl sm:left-auto sm:right-6 sm:top-6 sm:max-h-[90%] sm:w-[360px]">
      <div className="relative border-b border-border-subtle p-5 pb-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-400">
            {nodeType}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-primary"
            aria-label="Close inspector"
          >
            <CloseIcon />
          </button>
        </div>
        <h2 className="mb-3 text-lg font-bold leading-tight text-primary">
          {title}
        </h2>
        {isBlog && selectedNode.author && (
          <p className="mb-1 text-[11px] font-medium tracking-wide text-gray-600">
            AUTHOR: {selectedNode.author}
          </p>
        )}
        {(isGroup || isBlog) && (selectedNode.stackTitle || stackId) && (
          <p className="mb-3 text-xs text-slate-500">
            {selectedNode.stackTitle ||
              bloggs.find((blogg) => blogg.blogg_id === selectedBloggId)
                ?.stack_id ||
              "Stack"}
            {selectedNode.groupTitle ? ` / ${selectedNode.groupTitle}` : ""}
          </p>
        )}

        {isBlog && (
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={() => onOpenBlogg(String(selectedNode.id), false)}
              className="flex w-full items-center justify-center gap-2 bg-gray-900 py-2 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm hover:bg-accent-hover"
            >
              <OpenIcon /> Open Blog
            </button>
            {canEdit && (
              <button
                onClick={() => onOpenBlogg(String(selectedNode.id), true)}
                className="flex w-full items-center justify-center gap-2 border border-slate-300 bg-white py-2 text-[10px] font-bold uppercase tracking-widest text-primary hover:border-slate-500"
              >
                <LinkIcon /> Manage References
              </button>
            )}
          </div>
        )}
      </div>

      {isBlog && (
        <div className="space-y-4 p-4">
          {selectedNode.description && (
            <section>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Blog preview
              </h3>
              <div className="max-h-28 overflow-y-auto rounded border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700">
                {selectedNode.description}
              </div>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Footnotes
              </h3>
              <span className="text-[10px] tabular-nums text-slate-400">
                {outgoingReferences.length}
              </span>
            </div>
            {outgoingReferences.length === 0 ? (
              <p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">
                No references yet. Add one manually in the blog editor; nothing
                is linked automatically.
              </p>
            ) : (
              <ol className="space-y-2">
                {outgoingReferences.map(
                  ({
                    reference_id,
                    target_blogg_id,
                    target_title,
                    target_excerpt,
                    target,
                  }) => (
                    <li
                      key={reference_id}
                      className="rounded border border-slate-200 bg-white p-3"
                    >
                      <button
                        onClick={() => openReferencedBlog(target_blogg_id)}
                        className="flex w-full items-start gap-2 text-left text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        <OpenIcon />
                        <span>
                          {target_title || target?.title || "Referenced blog"}
                        </span>
                      </button>
                      {target_excerpt && (
                        <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs leading-5 text-slate-600">
                          {target_excerpt}
                        </blockquote>
                      )}
                    </li>
                  ),
                )}
              </ol>
            )}
          </section>

          {incomingReferences.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Referenced by
              </h3>
              <ul className="space-y-2">
                {incomingReferences.map(({ source, reference }) => (
                  <li
                    key={`${source.blogg_id}:${reference.reference_id}`}
                    className="rounded border border-slate-200 bg-white p-3"
                  >
                    <button
                      onClick={() => openReferencedBlog(source.blogg_id)}
                      className="text-left text-xs font-semibold text-blue-700 hover:underline"
                    >
                      {source.title || "Another blog"}
                    </button>
                    {reference.target_excerpt && (
                      <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs leading-5 text-slate-600">
                        {reference.target_excerpt}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
