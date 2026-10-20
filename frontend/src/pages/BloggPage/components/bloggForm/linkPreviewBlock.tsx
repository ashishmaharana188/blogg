import { createReactBlockSpec } from "@blocknote/react";
import "./linkPreview.css";

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const createLinkPreview = createReactBlockSpec(
  {
    type: "linkPreview",
    propSchema: {
      url: { default: "" },
      title: { default: "Link preview" },
      description: { default: "" },
      image: { default: "" },
      provider: { default: "web" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const href = safeHref(block.props.url);
      let hostname = block.props.provider || "Website";
      try {
        hostname = new URL(block.props.url).hostname.replace(/^www\./i, "");
      } catch {
        // Keep the provider label when the URL is still being resolved.
      }

      return (
        <article className="blogg-link-preview" contentEditable={false}>
          {href ? (
            <a className={`blogg-link-preview-anchor ${block.props.image && safeHref(block.props.image) ? "has-image" : "no-image"}`} href={href} target="_blank" rel="noopener noreferrer">
              {block.props.image && safeHref(block.props.image) && (
                <div className="blogg-link-preview-media">
                  <img src={block.props.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                </div>
              )}
              <div className="blogg-link-preview-copy">
                <span className="blogg-link-preview-provider">{hostname}</span>
                <strong className="blogg-link-preview-title">{block.props.title || hostname}</strong>
                {block.props.description && <span className="blogg-link-preview-description">{block.props.description}</span>}
                <span className="blogg-link-preview-url">{href}</span>
              </div>
              <span className="blogg-link-preview-open" aria-hidden="true">↗</span>
            </a>
          ) : (
            <div className="blogg-link-preview-copy">
              <strong className="blogg-link-preview-title">Invalid link</strong>
              <span className="blogg-link-preview-description">This preview does not contain a valid HTTP or HTTPS URL.</span>
            </div>
          )}
        </article>
      );
    },
  },
);
