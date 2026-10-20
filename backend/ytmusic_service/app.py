import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from ytmusicapi import YTMusic

app = FastAPI(title="Blogg YouTube Music Bridge")
logger = logging.getLogger("uvicorn.error")

SERVICE_TOKEN = os.getenv("YTMUSIC_SERVICE_TOKEN", "").strip()
AUTH_FILE = Path(
    os.getenv("YTMUSIC_AUTH_FILE", "/etc/secrets/ytmusic-browser.json")
).expanduser()

# ytmusicapi OAuth authentication currently fails with upstream HTTP 400 for
# authenticated YouTube Music internal API calls. Browser-auth JSON is the
# documented workaround. The runtime copy must be named browser.json because
# ytmusicapi uses the filename to distinguish browser headers from oauth.json.
RUNTIME_AUTH_DIR = Path(
    os.getenv("YTMUSIC_RUNTIME_AUTH_DIR", "/tmp/ytmusic-auth")
).expanduser()
RUNTIME_BROWSER_FILE = RUNTIME_AUTH_DIR / "browser.json"

LIMIT = max(1, min(int(os.getenv("YTMUSIC_LIKED_LIMIT", "25")), 50))
_auth_lock = threading.Lock()
_history_disabled_warned = False
_history_disabled_lock = threading.Lock()


def _log_history_disabled_once() -> None:
    """Avoid repeated error tracebacks when YouTube watch history is disabled."""
    global _history_disabled_warned
    with _history_disabled_lock:
        if _history_disabled_warned:
            return
        logger.warning(
            "YouTube Music watch history is disabled for this account; "
            "last-played sync is skipped until YouTube History is enabled."
        )
        _history_disabled_warned = True



def _read_auth_file() -> dict:
    if not AUTH_FILE.is_file():
        raise RuntimeError(
            f"YouTube Music auth file is missing at {AUTH_FILE}. Configure "
            "YTMUSIC_AUTH_FILE to point to the mounted browser-auth secret file."
        )
    if not os.access(AUTH_FILE, os.R_OK):
        raise RuntimeError("YouTube Music auth file is not readable.")

    try:
        data = json.loads(AUTH_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            "YouTube Music auth file could not be read as valid UTF-8 JSON."
        ) from exc

    if not isinstance(data, dict):
        raise RuntimeError("YouTube Music auth file must contain a JSON object.")
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


def _prepare_runtime_browser_file(data: dict) -> str:
    # Never modify the mounted Render secret. Copy it atomically to writable
    # runtime storage. Preserve the required basename "browser.json".
    try:
        RUNTIME_AUTH_DIR.mkdir(parents=True, exist_ok=True)
        temporary_path: Optional[Path] = None
        with _auth_lock:
            try:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    prefix=".browser-auth-",
                    suffix=".tmp",
                    dir=str(RUNTIME_AUTH_DIR),
                    delete=False,
                ) as temporary_file:
                    temporary_path = Path(temporary_file.name)
                    os.fchmod(temporary_file.fileno(), 0o600)
                    json.dump(data, temporary_file, ensure_ascii=False)
                    temporary_file.flush()
                    os.fsync(temporary_file.fileno())

                os.replace(temporary_path, RUNTIME_BROWSER_FILE)
                os.chmod(RUNTIME_BROWSER_FILE, 0o600)
            finally:
                if temporary_path is not None and temporary_path.exists():
                    temporary_path.unlink()
    except OSError as exc:
        raise RuntimeError(
            "Could not prepare the writable browser-auth file. Check the "
            "YTMUSIC_RUNTIME_AUTH_DIR setting and runtime filesystem."
        ) from exc

    return str(RUNTIME_BROWSER_FILE)


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


def _auth_status(data: Optional[dict], auth_error: Optional[str] = None) -> dict:
    if not data:
        mode = "invalid" if auth_error else "missing"
        missing = ["cookie", "authorization", "x-goog-authuser", "x-origin"]
    elif data.get("refresh_token") and data.get("access_token"):
        mode = "oauth"
        missing = ["browser headers: Cookie, Authorization, X-Goog-AuthUser, x-origin"]
    else:
        missing = _browser_auth_missing_headers(data)
        mode = "browser" if not missing else "invalid"

    return {
        "ok": True,
        "authConfigured": AUTH_FILE.is_file(),
        "authReadable": AUTH_FILE.is_file() and os.access(AUTH_FILE, os.R_OK),
        "authMode": mode,
        "browserAuthReady": mode == "browser",
        "missingBrowserHeaders": missing,
        "runtimeAuthDirectoryWritable": _runtime_directory_writable(),
        "runtimeBrowserAuthPrepared": (
            RUNTIME_BROWSER_FILE.is_file()
            and os.access(RUNTIME_BROWSER_FILE, os.R_OK | os.W_OK)
        ),
        "tokenConfigured": bool(SERVICE_TOKEN),
    }


def get_client() -> YTMusic:
    auth_data = _read_auth_file()

    # Do not retry OAuth setup or rotate credentials here: the upstream
    # ytmusicapi OAuth path is currently rejected with HTTP 400 by YouTube
    # Music's internal API. Fail with a useful message instructing the operator
    # to configure the documented browser-header authentication instead.
    if auth_data.get("refresh_token") and auth_data.get("access_token"):
        raise RuntimeError(
            "The configured auth file contains OAuth tokens. ytmusicapi OAuth "
            "requests to YouTube Music are currently rejected with HTTP 400 "
            "(upstream ytmusicapi issue #813). Create a browser-auth JSON file "
            "using 'ytmusicapi browser', mount it as a Render secret file, and "
            "set YTMUSIC_AUTH_FILE to that file."
        )

    missing = _browser_auth_missing_headers(auth_data)
    if missing:
        raise RuntimeError(
            "The configured auth file is not a complete ytmusicapi browser-auth "
            f"file. Missing required header fields: {', '.join(missing)}. "
            "Create it with 'ytmusicapi browser' from a successful authenticated "
            "YouTube Music POST request."
        )

    runtime_file = _prepare_runtime_browser_file(auth_data)
    logger.info(
        "Using YouTube Music browser-header authentication from a writable "
        "runtime copy; the mounted secret was not modified."
    )
    # No OAuthCredentials here: browser.json contains the captured headers.
    return YTMusic(runtime_file)


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
    # This endpoint reports presence and readiness only; never expose auth values.
    try:
        data = _read_auth_file()
        status = _auth_status(data)
    except Exception as exc:
        status = _auth_status(None, str(exc))
        logger.warning("YouTube Music auth health check failed; error_type=%s", type(exc).__name__)

    status.update({
        "tokenConfigured": bool(SERVICE_TOKEN),
        "runtimeAuthDirectoryWritable": _runtime_directory_writable(),
    })
    return status


@app.get("/liked", response_model=SongList)
def liked(authorization: Optional[str] = Header(default=None)):
    if not SERVICE_TOKEN or authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        client = get_client()
    except Exception as exc:
        logger.exception(
            "YouTube Music client initialization failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"YouTube Music authentication setup failed ({type(exc).__name__}). "
                "Check the Python companion service logs and /health diagnostics."
            ),
        ) from exc

    try:
        liked_response = client.get_liked_songs(limit=LIMIT)
    except Exception as exc:
        logger.exception(
            "YouTube Music liked-song request failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"YouTube Music liked-song request failed ({type(exc).__name__}). "
                "Check the companion service logs for the upstream traceback."
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
        client = get_client()
        history_songs = client.get_history()
    except Exception as exc:
        # ytmusicapi raises YTMusicServerError when YouTube History is paused.
        # This is an account preference, not a broken authentication session.
        # Return a valid empty history page so the Node backend can retain the
        # previous last-played snapshot without producing repeated 502 tracebacks.
        if "Turn on your YouTube watch history" in str(exc):
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
                "Check the companion service logs for the upstream traceback."
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
