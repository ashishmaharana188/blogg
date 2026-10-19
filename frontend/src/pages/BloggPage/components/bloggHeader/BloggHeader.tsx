import { Link } from "react-router-dom";
import { useAuth } from "../../../../context/authContext";
import { useEffect } from "react";
import { sendAdminHeartbeat } from "../../../../services/adminStatusService";

type BloggHeaderProps = {
  page: "feed" | "profile";
  viewMode?: "canvas" | "flipbook";
  isFormOpen?: boolean;
  onToggleViewMode?: () => void;
  onNewNote?: () => void;
};

/** Shared header for Blog Feed and Blog Profile. Keep its layout consistent. */
export default function BloggHeader({
  page,
  viewMode = "canvas",
  isFormOpen = false,
  onToggleViewMode,
  onNewNote,
}: BloggHeaderProps) {
  const isProfile = page === "profile";
  const { isAdmin, refreshUser } = useAuth();

  useEffect(() => {
    if (!isAdmin) return;
    const heartbeat = () => { void sendAdminHeartbeat().catch(() => refreshUser()); };
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(interval);
  }, [isAdmin, refreshUser]);

  return (
    <div className="blogg-shared-header shrink-0 pt-6 px-6 sm:pt-10 sm:px-10 flex justify-between items-end pb-4 border-b border-slate-100 z-50 bg-white">
      <div className="flex flex-row justify-between items-center w-full mb-2">
        <div className="flex gap-4 shrink-0 self-start items-center">
          <Link
            className="text-black hover:font-bold"
            to={isProfile ? "/feed" : "/blog"}
          >
            {isProfile ? "BLOG FEED" : "BLOG PROFILE"}
          </Link>
          {isProfile && !isFormOpen && (
            <button
              className="text-sm text-gray-600 hover:text-black hover:font-bold ml-6"
              onClick={onToggleViewMode}
              type="button"
            >
              Switch to {viewMode === "canvas" ? "Flipbook" : "Folder"} View
            </button>
          )}
        </div>
        <hr className="w-350 border-black border-2 ml-5 mt-2" />
        <div className="flex gap-4 shrink-0 pl-4 self-end mt-2 items-center">
          {isAdmin && (
            <button
              className="text-black block hover:font-bold truncate"
              onClick={onNewNote}
              type="button"
            >
              {isProfile && isFormOpen ? "Close Note" : "New Note"}
            </button>
          )}
          <Link
            className="text-xs text-slate-500 hover:text-black whitespace-nowrap"
            to="/account"
            title={isAdmin ? "Administrator account and status" : "Administrator sign in and public status"}
          >
            {isAdmin ? "Admin" : "Account"}
          </Link>
        </div>
      </div>
    </div>
  );
}
