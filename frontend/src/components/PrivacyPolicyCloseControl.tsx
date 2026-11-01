import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import "./privacyPolicyClose.css";

/** Adds an immediate close control to the public privacy-policy page. */
export default function PrivacyPolicyCloseControl() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (location.pathname !== "/privacy") {
      setMountNode(null);
      return;
    }

    const target = document.querySelector<HTMLElement>(".blogg-legal-topline");
    if (!target) return;

    const mount = document.createElement("div");
    mount.className = "blogg-privacy-close-mount";
    target.appendChild(mount);
    setMountNode(mount);

    return () => {
      mount.remove();
      setMountNode((current) => current === mount ? null : current);
    };
  }, [location.pathname]);

  if (location.pathname !== "/privacy" || !mountNode) return null;

  return createPortal(
    <button
      type="button"
      className="blogg-privacy-close-button"
      onClick={() => navigate("/feed", { replace: true })}
    >
      Close policy
    </button>,
    mountNode,
  );
}
