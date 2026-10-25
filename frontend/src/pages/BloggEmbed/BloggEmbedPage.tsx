import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { BloggItem } from "../../types/pageTypes";
import AssetStateBox from "../../components/AssetStateBox";
import CopyrightNotice from "../../components/CopyrightNotice";
import { fetchBloggByIdRequest, fetchStackAndGroup } from "../BloggPage/services/canvasViewService";
import { ReadOnlyBloggContent } from "../BloggPage/components/bloggProfile/flipBook/readOnlyBloggContent";
import "./bloggEmbed.css";

type Stack = { stack_id: string; stack_name: string };
type Group = { group_id: string; group_name: string; stack_id: string };

export default function BloggEmbedPage() {
  const { bloggId = "" } = useParams<{ bloggId: string }>();
  const [blogg, setBlogg] = useState<BloggItem | null>(null);
  const [stackName, setStackName] = useState("Unsorted stack");
  const [groupName, setGroupName] = useState("Others");
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setStatus("loading");
      try {
        const [note, canvas] = await Promise.all([
          fetchBloggByIdRequest({ blogg_id: bloggId }, { retryTransientErrors: true }),
          fetchStackAndGroup({ publicReadOnly: true, retryTransientErrors: true }),
        ]);
        if (cancelled) return;
        if (!note) {
          setStatus("missing");
          return;
        }
        setBlogg(note as BloggItem);
        const stacks = (canvas?.stacks ?? []) as Stack[];
        const groups = (canvas?.groups ?? []) as Group[];
        const group = groups.find((item) => item.group_id === note.group_id);
        const stack = stacks.find((item) => item.stack_id === note.stack_id) ??
          stacks.find((item) => item.stack_id === group?.stack_id);
        setStackName(stack?.stack_name || "Unsorted stack");
        setGroupName(group?.group_name || "Others");
        setStatus("ready");
      } catch (error) {
        console.error("Could not load embedded note:", error);
        if (!cancelled) setStatus("error");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [bloggId]);

  if (status === "loading" || status === "error") {
    return (
      <main className="blogg-embed-shell typewriter-font">
        <AssetStateBox
          status={status}
          onRetry={status === "error" ? () => window.location.reload() : undefined}
        />
      </main>
    );
  }

  if (status === "missing" || !blogg) {
    return (
      <main className="blogg-embed-shell typewriter-font">
        <div className="blogg-embed-card">
          <p>This note could not be found.</p>
        </div>
      </main>
    );
  }

  const noteUrl = `${window.location.origin}/read/${encodeURIComponent(blogg.blogg_id || blogg._id)}`;

  return (
    <main className="blogg-embed-shell typewriter-font">
      <a className="blogg-embed-card-link" href={noteUrl} target="_blank" rel="noreferrer">
        <article className="blogg-embed-card">
          <div className="blogg-embed-meta">
            <strong>{blogg.author?.trim() || "Unknown author"}</strong>
            <span>{stackName} › {groupName}</span>
          </div>
          <h1>{blogg.title || "Untitled note"}</h1>
          {blogg.subtitle && <p className="blogg-embed-subtitle">{blogg.subtitle}</p>}
          <div className="blogg-embed-body">
            <ReadOnlyBloggContent content={Array.isArray(blogg.content) ? blogg.content : []} />
          </div>
          {!!blogg.tags?.length && (
            <div className="blogg-embed-tags">
              {blogg.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          )}
          <footer>Open full note ↗</footer>
          <CopyrightNotice enabled={blogg.showCopyright} holder={blogg.copyrightHolder} author={blogg.author} createdAt={blogg.createdAt} />
        </article>
      </a>
      <p className="blogg-embed-brand"><Link to="/feed">Blogg</Link></p>
    </main>
  );
}
