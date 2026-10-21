import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from ytmusicapi import OAuthCredentials, YTMusic

app = FastAPI(title="Blogg YouTube Music Bridge")
logger = logging.getLogger("uvicorn.error")

SERVICE_TOKEN = os.getenv("YTMUSIC_SERVICE_TOKEN", "").strip()

# OAuth is attempted first whenever a valid oauth.json and matching client
# credentials are configured. YTMUSIC_AUTH_FILE remains the browser.json
# fallback for compatibility with the existing Render secret-file setup.
OAUTH_FILE = Path(
    os.getenv("YTMUSIC_OAUTH_FILE", "/etc/secrets/ytmusic-oauth.json")
).expanduser()
OAUTH_CLIENT_ID = os.getenv("YTMUSIC_OAUTH_CLIENT_ID", "").strip()
OAUTH_CLIENT_SECRET = os.getenv("YTMUSIC_OAUTH_CLIENT_SECRET", "").strip()
BROWSER_AUTH_FILE = Path(
    os.getenv("YTMUSIC_AUTH_FILE", "/etc/secrets/ytmusic-browser.json")
).expanduser()
# Keep the prior symbol for compatibility with internal references and logs.
AUTH_FILE = BROWSER_AUTH_FILE

RUNTIME_AUTH_DIR = Path(
    os.getenv("YTMUSIC_RUNTIME_AUTH_DIR", "/tmp/ytmusic-auth")
).expanduser()
RUNTIME_OAUTH_FILE = RUNTIME_AUTH_DIR / "oauth.json"
RUNTIME_BROWSER_FILE = RUNTIME_AUTH_DIR / "browser.json"

LIMIT = max(1, min(int(os.getenv("YTMUSIC_LIKED_LIMIT", "25")), 50))
_auth_lock = threading.Lock()
_history_disabled_warned = False
_history_disabled_lock = threading.Lock()


def _log_history_disabled_once() -> None:
    """Avoid repeating tracebacks when this account has YouTube History paused."""
    global _history_disabled_warned
    with _history_disabled_lock:
        if _history_disabled_warned:
            return
        logger.warning(
            "YouTube Music watch history is disabled for this account; "
            "last-played sync is skipped until YouTube History is enabled."
        )
        _history_disabled_warned = True


def _read_auth_file(path: Path = BROWSER_AUTH_FILE, label: str = "browser-auth") -> dict:
    if not path.is_file():
        raise RuntimeError(f"YouTube Music {label} file is missing at {path}.")
    if not os.access(path, os.R_OK):
        raise RuntimeError(f"YouTube Music {label} file is not readable.")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            f"YouTube Music {label} file could not be read as valid UTF-8 JSON."
        ) from exc

    if not isinstance(data, dict):
        raise RuntimeError(f"YouTube Music {label} file must contain a JSON object.")
    return data


def _header_value(headers: dict, target: str) -> str:
    target_lower = target.lower()
    for key, value in headers.items():
        if str(key).lower() == target_lower and isinstance(value, str):
            return value.strip()
    return ""


def _browser_auth_missing_headers(data: dict) -> list[str]:
    # Match the core fields in ytmusicapi's documented browser-auth setup.
    required = ("cookie", "authorization", "x-goog-authuser", "x-origin")
    return [name for name in required if not _header_value(data, name)]


def _prepare_runtime_auth_file(data: dict, destination: Path, label: str) -> str:
    """Copy a mounted auth secret to writable runtime storage without changing it."""
    try:
        RUNTIME_AUTH_DIR.mkdir(parents=True, exist_ok=True)
        temporary_path: Optional[Path] = None
        with _auth_lock:
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    prefix=f".{label}-",
                    suffix=".tmp",
                    dir=str(RUNTIME_AUTH_DIR),
                    delete=False,
                ) as temporary_file:
                    temporary_path = Path(temporary_file.name)
                    os.fchmod(temporary_file.fileno(), 0o600)
                    json.dump(data, temporary_file, ensure_ascii=False)
                    temporary_file.flush()
                    os.fsync(temporary_file.fileno())

                os.replace(temporary_path, destination)
                os.chmod(destination, 0o600)
            finally:
                if temporary_path is not None and temporary_path.exists():
                    temporary_path.unlink()
    except OSError as exc:
        raise RuntimeError(
            f"Could not prepare the writable {label} file. Check "
            "YTMUSIC_RUNTIME_AUTH_DIR and runtime filesystem permissions."
        ) from exc

    return str(destination)


def _prepare_runtime_browser_file(data: dict) -> str:
    # Keep the basename browser.json; ytmusicapi uses the auth file contents
    # and file naming convention to distinguish browser-header credentials.
    return _prepare_runtime_auth_file(data, RUNTIME_BROWSER_FILE, "browser-auth")


def _prepare_runtime_oauth_file(data: dict) -> str:
    # Reuse the writable cache after first initialization so refreshed access or
    # refresh tokens are not overwritten by the read-only mounted secret on each
    # request. A fresh container copies the mounted token file once.
    if RUNTIME_OAUTH_FILE.is_file() and os.access(RUNTIME_OAUTH_FILE, os.R_OK | os.W_OK):
        return str(RUNTIME_OAUTH_FILE)
    return _prepare_runtime_auth_file(data, RUNTIME_OAUTH_FILE, "oauth-token")


def _runtime_directory_writable() -> bool:
    try:
        RUNTIME_AUTH_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=".health-check-",
            suffix=".tmp",
            dir=str(RUNTIME_AUTH_DIR),
            delete=True,
        ):
            return True
    except OSError:
        return False


def _oauth_status() -> tuple[bool, Optional[str], Optional[dict]]:
    if not OAUTH_CLIENT_ID or not OAUTH_CLIENT_SECRET:
        return False, "YTMUSIC_OAUTH_CLIENT_ID and YTMUSIC_OAUTH_CLIENT_SECRET are not both configured", None
    try:
        data = _read_auth_file(OAUTH_FILE, "OAuth token")
    except Exception as exc:
        return False, str(exc), None
    if not isinstance(data.get("access_token"), str) or not data.get("access_token"):
        return False, "OAuth token file has no access_token", data
    if not isinstance(data.get("refresh_token"), str) or not data.get("refresh_token"):
        return False, "OAuth token file has no refresh_token; regenerate oauth.json with offline access", data
    return True, None, data


def _browser_status() -> tuple[bool, Optional[str], Optional[dict], list[str]]:
    try:
        data = _read_auth_file(BROWSER_AUTH_FILE, "browser-auth")
    except Exception as exc:
        return False, str(exc), None, ["cookie", "authorization", "x-goog-authuser", "x-origin"]
    missing = _browser_auth_missing_headers(data)
    if missing:
        return False, f"Browser-auth file is missing required header fields: {', '.join(missing)}", data, missing
    return True, None, data, []


def _make_oauth_client() -> YTMusic:
    ready, reason, data = _oauth_status()
    if not ready or data is None:
        raise RuntimeError(reason or "YouTube Music OAuth is not configured.")
    runtime_file = _prepare_runtime_oauth_file(data)
    credentials = OAuthCredentials(
        client_id=OAUTH_CLIENT_ID,
        client_secret=OAUTH_CLIENT_SECRET,
    )
    return YTMusic(runtime_file, oauth_credentials=credentials)


def _make_browser_client() -> YTMusic:
    ready, reason, data, missing = _browser_status()
    if not ready or data is None:
        raise RuntimeError(reason or f"Browser-auth is not ready: {', '.join(missing)}")
    runtime_file = _prepare_runtime_browser_file(data)
    return YTMusic(runtime_file)


def _safe_error_message(error: Exception, limit: int = 240) -> str:
    detail = str(error).replace("\n", " ").strip()
    # Defensive redaction if a provider exception ever includes a configured secret.
    for secret in (SERVICE_TOKEN, OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID):
        if secret:
            detail = detail.replace(secret, "[redacted]")
    return detail[:limit]


def _history_is_disabled(error: Exception) -> bool:
    return "Turn on your YouTube watch history" in str(error)


def _run_with_auth_fallback(action: str, operation):
    """Try OAuth first; retry the same read operation using browser.json on failure."""
    oauth_ready, oauth_reason, _ = _oauth_status()
    oauth_error: Optional[Exception] = None

    if oauth_ready:
        try:
            result = operation(_make_oauth_client())
            logger.info("YouTube Music request succeeded; action=%s auth_mode=oauth", action)
            return result
        except Exception as exc:
            # A paused YouTube watch-history setting is an account preference,
            # not an OAuth failure. Let the history route handle it as empty history.
            if action == "history" and _history_is_disabled(exc):
                raise
            oauth_error = exc
            logger.warning(
                "YouTube Music OAuth request failed; action=%s error_type=%s detail=%s; trying browser-auth fallback",
                action,
                type(exc).__name__,
                _safe_error_message(exc),
            )
    else:
        logger.info(
            "YouTube Music OAuth unavailable; action=%s reason=%s; trying browser-auth fallback",
            action,
            oauth_reason or "OAuth token is not ready",
        )

    try:
        result = operation(_make_browser_client())
        logger.info(
            "YouTube Music request succeeded; action=%s auth_mode=browser_fallback",
            action,
        )
        return result
    except Exception as browser_error:
        if action == "history" and _history_is_disabled(browser_error):
            raise
        if oauth_error is not None:
            raise RuntimeError(
                f"OAuth attempt failed ({type(oauth_error).__name__}: {_safe_error_message(oauth_error)}); "
                f"browser-auth fallback failed ({type(browser_error).__name__}: {_safe_error_message(browser_error)})."
            ) from browser_error
        raise


def _auth_status() -> dict:
    oauth_ready, oauth_reason, _ = _oauth_status()
    browser_ready, browser_reason, browser_data, missing = _browser_status()
    if oauth_ready and browser_ready:
        mode = "oauth_with_browser_fallback"
    elif oauth_ready:
        mode = "oauth"
    elif browser_ready:
        mode = "browser_fallback_only"
    else:
        mode = "invalid_or_missing"

    return {
        "ok": True,
        "authConfigured": bool(oauth_ready or browser_ready),
        "authReadable": bool(oauth_ready or browser_data is not None),
        "authMode": mode,
        "oauthConfigured": oauth_ready,
        "oauthFileConfigured": OAUTH_FILE.is_file(),
        "oauthCredentialsConfigured": bool(OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET),
        "oauthIssue": None if oauth_ready else oauth_reason,
        "browserAuthReady": browser_ready,
        "browserAuthConfigured": BROWSER_AUTH_FILE.is_file(),
        "browserAuthIssue": None if browser_ready else browser_reason,
        "missingBrowserHeaders": missing,
        "runtimeAuthDirectoryWritable": _runtime_directory_writable(),
        "runtimeOAuthPrepared": (
            RUNTIME_OAUTH_FILE.is_file()
            and os.access(RUNTIME_OAUTH_FILE, os.R_OK | os.W_OK)
        ),
        "runtimeBrowserAuthPrepared": (
            RUNTIME_BROWSER_FILE.is_file()
            and os.access(RUNTIME_BROWSER_FILE, os.R_OK | os.W_OK)
        ),
        "tokenConfigured": bool(SERVICE_TOKEN),
    }


class Song(BaseModel):
    title: str
    artists: list[str] = Field(default_factory=list)
    album: Optional[str] = None
    thumbnail: Optional[str] = None
    url: Optional[str] = None
    videoId: Optional[str] = None


class SongList(BaseModel):
    items: list[Song]


@app.get("/health")
def health():
    # Reports only presence/readiness; never return tokens, cookies or headers.
    status = _auth_status()
    status["tokenConfigured"] = bool(SERVICE_TOKEN)
    status["runtimeAuthDirectoryWritable"] = _runtime_directory_writable()
    return status


@app.get("/liked", response_model=SongList)
def liked(authorization: Optional[str] = Header(default=None)):
    if not SERVICE_TOKEN or authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        liked_response = _run_with_auth_fallback(
            "liked",
            lambda client: client.get_liked_songs(limit=LIMIT),
        )
    except Exception as exc:
        logger.exception(
            "YouTube Music liked-song request failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"YouTube Music liked-song request failed ({type(exc).__name__}). "
                "Check the companion service logs for OAuth and browser-fallback diagnostics."
            ),
        ) from exc

    # ytmusicapi's get_liked_songs() returns a playlist dictionary whose song
    # entries are in `tracks`. Iterating the outer dictionary yields string
    # keys, which is why calling .get() on each item previously crashed.
    # Accept a list as well to remain compatible with alternate API versions.
    if isinstance(liked_response, dict):
        songs = liked_response.get("tracks")
        if not isinstance(songs, list):
            songs = liked_response.get("songs")
    elif isinstance(liked_response, list):
        songs = liked_response
    else:
        songs = None

    if not isinstance(songs, list):
        response_keys = sorted(liked_response.keys()) if isinstance(liked_response, dict) else []
        logger.error(
            "Unexpected YouTube Music liked-songs response shape; response_type=%s keys=%s",
            type(liked_response).__name__,
            response_keys,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "YouTube Music returned an unexpected liked-songs response shape. "
                "Check the companion service logs for response diagnostics."
            ),
        )

    items = []
    skipped_entries = 0
    for song in songs:
        if not isinstance(song, dict):
            skipped_entries += 1
            continue

        video_id = song.get("videoId")
        thumbnails = song.get("thumbnails") or []
        if not isinstance(thumbnails, list):
            thumbnails = []

        artists_data = song.get("artists") or []
        if not isinstance(artists_data, list):
            artists_data = []
        artists = []
        for artist in artists_data:
            if isinstance(artist, dict):
                name = artist.get("name")
                if isinstance(name, str) and name.strip():
                    artists.append(name.strip())
            elif isinstance(artist, str) and artist.strip():
                artists.append(artist.strip())

        album_data = song.get("album")
        if isinstance(album_data, dict):
            album_name = album_data.get("name")
        elif isinstance(album_data, str):
            album_name = album_data
        else:
            album_name = None

        thumbnail_url = None
        for thumbnail in reversed(thumbnails):
            if isinstance(thumbnail, dict) and thumbnail.get("url"):
                thumbnail_url = thumbnail["url"]
                break

        items.append(
            Song(
                title=song.get("title") or "Untitled track",
                artists=artists,
                album=album_name,
                thumbnail=thumbnail_url,
                url=f"https://music.youtube.com/watch?v={video_id}" if video_id else None,
                videoId=video_id,
            )
        )

    if skipped_entries:
        logger.warning(
            "Skipped malformed YouTube Music liked-song entries; skipped_count=%d",
            skipped_entries,
        )
    logger.info("Retrieved YouTube Music liked songs; item_count=%d", len(items))
    return {"items": items}


@app.get("/history", response_model=SongList)
def history(authorization: Optional[str] = Header(default=None)):
    if not SERVICE_TOKEN or authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        history_songs = _run_with_auth_fallback(
            "history",
            lambda client: client.get_history(),
        )
    except Exception as exc:
        if _history_is_disabled(exc):
            _log_history_disabled_once()
            return {"items": []}
        logger.exception(
            "YouTube Music history request failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"YouTube Music history request failed ({type(exc).__name__}). "
                "Check the companion service logs for OAuth and browser-fallback diagnostics."
            ),
        ) from exc

    if not isinstance(history_songs, list):
        logger.error(
            "Unexpected YouTube Music history response shape; response_type=%s",
            type(history_songs).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail="YouTube Music returned an unexpected history response shape.",
        )

    items = []
    for song in history_songs[:LIMIT]:
        if not isinstance(song, dict):
            continue

        video_id = song.get("videoId")
        thumbnails = song.get("thumbnails") or []
        if not isinstance(thumbnails, list):
            thumbnails = []

        artists_data = song.get("artists") or []
        if not isinstance(artists_data, list):
            artists_data = []
        artists = []
        for artist in artists_data:
            if isinstance(artist, dict):
                name = artist.get("name")
            elif isinstance(artist, str):
                name = artist
            else:
                name = None
            if isinstance(name, str) and name.strip():
                artists.append(name.strip())

        album_data = song.get("album")
        if isinstance(album_data, dict):
            album_name = album_data.get("name")
        elif isinstance(album_data, str):
            album_name = album_data
        else:
            album_name = None

        thumbnail_url = None
        for thumbnail in reversed(thumbnails):
            if isinstance(thumbnail, dict) and thumbnail.get("url"):
                thumbnail_url = thumbnail["url"]
                break

        items.append(
            Song(
                title=song.get("title") or "Untitled track",
                artists=artists,
                album=album_name,
                thumbnail=thumbnail_url,
                url=f"https://music.youtube.com/watch?v={video_id}" if video_id else None,
                videoId=video_id,
            )
        )

    logger.info("Retrieved YouTube Music history; item_count=%d", len(items))
    return {"items": items}
