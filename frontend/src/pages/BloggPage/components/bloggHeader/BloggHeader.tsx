import { Link } from "react-router-dom";
import { useAuth } from "../../../../context/authContext";
import { useEffect, useState } from "react";
import { sendAdminHeartbeat } from "../../../../services/adminStatusService";
import FeedShareButton from "../../../../components/FeedShareButton";
import "./bloggHeaderMobileCollapse.css";

type BloggHeaderProps = {
  page: "feed" | "profile";
  viewMode?: "canvas" | "flipbook" | "filesystem";
  isFormOpen?: boolean;
  onToggleViewMode?: () => void;
  onToggleFileExplorer?: () => void;
  onNewNote?: () => void;
};

/** Shared header for Blog Feed and Blog Profile. Keep its layout consistent. */
export default function BloggHeader({
  page,
  viewMode = "canvas",
  isFormOpen = false,
  onToggleViewMode,
  onToggleFileExplorer,
  onNewNote,
}: BloggHeaderProps) {
  const isProfile = page === "profile";
  const { isAdmin, refreshUser } = useAuth();
  const [isMobileHeaderMinimized, setIsMobileHeaderMinimized] = useState(false);

  // The hidden capture iframe must match the public view, not the administrator's
  // editing controls. This flag affects presentation only; the upload endpoint
  // independently verifies the administrator's authenticated session.
  const isFeedSnapshotCapture =
    !isProfile &&
    new URLSearchParams(window.location.search).get("captureFeedSnapshot") === "1";

  useEffect(() => {
    if (!isAdmin) return;
    const heartbeat = () => {
      void sendAdminHeartbeat().catch(() => refreshUser());
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(interval);
  }, [isAdmin, refreshUser]);

  // Never leave the entire site header hidden after returning to a desktop width.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const resetOnDesktop = () => {
      if (!media.matches) setIsMobileHeaderMinimized(false);
    };
    resetOnDesktop();
    media.addEventListener("change", resetOnDesktop);
    return () => media.removeEventListener("change", resetOnDesktop);
  }, []);

  // Feed and Profile share this component; expand the header when changing page.
  useEffect(() => {
    setIsMobileHeaderMinimized(false);
  }, [page]);

  return (
    <div className={`blogg-shared-header shrink-0 px-4 pt-4 sm:pt-7 sm:px-6 lg:pt-10 lg:px-10 flex justify-between items-end pb-3 border-b border-slate-100 z-50 bg-white${isMobileHeaderMinimized ? " is-mobile-minimized" : ""}`}>
      {isMobileHeaderMinimized ? (
        <div className="blogg-mobile-header-collapsed-bar">
          <Link to={isProfile ? "/feed" : "/blog"}>
            {isProfile ? "BLOG PROFILE" : "BLOG FEED"}
          </Link>
          <button
            type="button"
            className="blogg-mobile-header-show-button"
            onClick={() => setIsMobileHeaderMinimized(false)}
            aria-expanded={false}
            aria-label="Show full Blogg header"
          >
            Show header <span aria-hidden="true">⌄</span>
          </button>
        </div>
      ) : (
        <div className="blogg-shared-header-inner flex flex-row justify-between items-center w-full mb-2">
          <div className="blogg-shared-header-nav flex flex-row flex-wrap gap-4 min-w-0 self-start items-center">
            <Link className="text-black hover:font-bold" to={isProfile ? "/feed" : "/blog"}>
              {isProfile ? "BLOG FEED" : "BLOG PROFILE"}
            </Link>
            {page === "feed" && !isFeedSnapshotCapture && (
              <FeedShareButton canUpdateSnapshot={isAdmin} />
            )}
            {isProfile && !isFormOpen && (
              <button
                className="text-sm text-gray-600 hover:text-black hover:font-bold ml-0 sm:ml-2 md:ml-6"
                onClick={onToggleViewMode}
                type="button"
              >
                Switch to {viewMode === "flipbook" ? "Folder" : "Flipbook"} View
              </button>
            )}
            {isProfile && !isFormOpen && (
              <button
                className="text-sm text-gray-600 hover:text-black hover:font-bold ml-0 sm:ml-2"
                onClick={onToggleFileExplorer}
                type="button"
              >
                {viewMode === "filesystem" ? "Switch to Folder View" : "Switch to File Explorer"}
              </button>
            )}
          </div>
          <hr className="blogg-shared-header-rule flex-1 min-w-4 border-black border-2 mx-3 mt-2" />
          <div className="blogg-shared-header-actions flex gap-4 shrink-0 pl-4 self-end mt-2 items-center">
            {isAdmin && !isFeedSnapshotCapture && (
              <button
                className="text-black block hover:font-bold truncate"
                onClick={onNewNote}
                type="button"
              >
                {isProfile && isFormOpen ? "Close Note" : "New Note"}
              </button>
            )}
            <Link
              className="text-xm text-bold hover:text-black whitespace-nowrap"
              to="/account"
              title={isAdmin && !isFeedSnapshotCapture ? "Administrator account and status" : "Administrator sign in and public status"}
            >
              {isAdmin && !isFeedSnapshotCapture ? "Admin" : "Account"}
            </Link>
            <button
              type="button"
              className="blogg-mobile-header-minimise-button"
              onClick={() => setIsMobileHeaderMinimized(true)}
              aria-expanded={true}
              aria-label="Minimise Blogg header"
            >
              Minimise <span aria-hidden="true">⌃</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
