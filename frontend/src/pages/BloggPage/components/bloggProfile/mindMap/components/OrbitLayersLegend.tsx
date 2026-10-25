import { useState } from "react";

const OrbitLayersLegend = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="absolute right-8 top-6 z-10 font-sans text-primary">
      {!isExpanded ? (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          aria-expanded={false}
          aria-label="Show map legend"
          className="bg-surface/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:text-primary focus:outline-none focus-visible:underline"
        >
          Map legend <span aria-hidden="true">+</span>
        </button>
      ) : (
        <section
          aria-label="Map structure legend"
          className="w-64 border border-border-subtle bg-surface/95 p-4 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between border-b border-border-subtle pb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Map structure
            </h3>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              aria-expanded={true}
              aria-label="Minimize map legend"
              className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-primary focus:outline-none focus-visible:underline"
            >
              Hide −
            </button>
          </div>
          <ul className="space-y-2.5 text-[11px] font-medium text-primary">
            <li className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-gray-300 bg-white" />
              <span>Empty centre</span>
              <span className="ml-auto text-[9px] tracking-wider text-muted">NO DATA</span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
              <span>Stacks</span>
              <span className="ml-auto text-[9px] tracking-wider text-muted">LAYER 1</span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" />
              <span>Folders</span>
              <span className="ml-auto text-[9px] tracking-wider text-muted">LAYER 2</span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500" />
              <span>Blogs</span>
              <span className="ml-auto text-[9px] tracking-wider text-muted">LAYER 3</span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-px w-5 shrink-0 bg-teal-600" />
              <span>Manual reference</span>
            </li>
          </ul>
          <p className="mt-3 border-t border-border-subtle pt-2.5 text-[10px] leading-4 text-muted">
            The centre is intentionally empty. Stack → Folder → Blog ownership builds the three data rings; cross-links appear only when a reference is saved manually.
          </p>
        </section>
      )}
    </div>
  );
};

export default OrbitLayersLegend;
