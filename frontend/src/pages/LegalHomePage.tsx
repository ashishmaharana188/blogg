import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import HomePage from "./BloggFeed/BlogFeed";
import "./publicLegalPage.css";

/**
 * Keep the public feed as the homepage. The legal footer is briefly visible
 * on initial load, then removed from the layout automatically.
 */
export default function LegalHomePage() {
  const [showLegalFooter, setShowLegalFooter] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowLegalFooter(false);
    }, 2000);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="blogg-public-home-shell">
      <HomePage />
      {showLegalFooter && (
        <footer
          className="blogg-home-legal-footer"
          aria-label="About Blogg and legal information"
        >
          <p>
            Blogg is a publishing and personal library site for creating, organizing,
            reading, publishing, and sharing notes. Notes can be organized through
            folder and canvas views and read in a flipbook-style view. The site also
            provides an account dashboard, featured links, and optional personal
            library tools. Optional integrations can display public YouTube
            playlists, selected YouTube Music tracks, and Spotify playback information.
          </p>
          <nav aria-label="Legal links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </nav>
        </footer>
      )}
    </div>
  );
}
