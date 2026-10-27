import { useEffect, useState } from "react";

const THEME_PREFERENCE_KEY = "blogg-dark-mode-enabled";
const DARK_MODE_CLASS = "blogg-dark-mode";

function readThemePreference(): boolean {
  try {
    const enabled = window.localStorage.getItem(THEME_PREFERENCE_KEY) === "true";
    document.documentElement.classList.toggle(DARK_MODE_CLASS, enabled);
    return enabled;
  } catch {
    document.documentElement.classList.remove(DARK_MODE_CLASS);
    return false;
  }
}

export default function SiteThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState(readThemePreference);

  useEffect(() => {
    document.documentElement.classList.toggle(DARK_MODE_CLASS, isDarkMode);
    try {
      window.localStorage.setItem(THEME_PREFERENCE_KEY, String(isDarkMode));
    } catch {
      // The active theme still works for this visit when storage is unavailable.
    }
  }, [isDarkMode]);

  const params = new URLSearchParams(window.location.search);
  const isSnapshotCapture =
    params.get("captureFeedSnapshot") === "1" ||
    params.get("captureSnapshot") === "1";

  if (isSnapshotCapture) return null;

  return (
    <button
      type="button"
      className="blogg-theme-toggle"
      aria-pressed={isDarkMode}
      aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
      title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setIsDarkMode((current) => !current)}
    >
      <span className="blogg-theme-toggle-icon" aria-hidden="true">
        {isDarkMode ? "☼" : "☾"}
      </span>
      <span>{isDarkMode ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
