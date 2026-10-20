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
AUTH_FILE = Path(os.getenv("YTMUSIC_AUTH_FILE", "/etc/secrets/ytmusic-oauth.json")).expanduser()
# Render secret files are read-only. ytmusicapi refreshes OAuth tokens and writes
# updated token data back to its auth file, so it must receive a writable copy.
# Keep "oauth.json" in the filename because ytmusicapi uses the auth filename
# when identifying OAuth credentials.
RUNTIME_AUTH_FILE = Path(
    os.getenv("YTMUSIC_RUNTIME_AUTH_FILE", "/tmp/ytmusic-oauth.json")
).expanduser()
OAUTH_CLIENT_ID = os.getenv("YTMUSIC_OAUTH_CLIENT_ID", "").strip()
OAUTH_CLIENT_SECRET = os.getenv("YTMUSIC_OAUTH_CLIENT_SECRET", "").strip()
LIMIT = max(1, min(int(os.getenv("YTMUSIC_LIKED_LIMIT", "25")), 50))

_auth_file_lock = threading.Lock()
_runtime_auth_initialized = False


def _prepare_runtime_auth_file() -> str:
    """Copy the mounted, read-only OAuth secret to a private writable file once per process."""
    global _runtime_auth_initialized

    if not AUTH_FILE.is_file():
        raise RuntimeError("YouTube Music auth file is missing.")
    if not os.access(AUTH_FILE, os.R_OK):
        raise RuntimeError("YouTube Music auth file is not readable.")

    source_path = AUTH_FILE.resolve()
    runtime_path = RUNTIME_AUTH_FILE.resolve()
    if source_path == runtime_path:
        raise RuntimeError(
            "YTMUSIC_RUNTIME_AUTH_FILE must point to a writable path different "
            "from YTMUSIC_AUTH_FILE; the mounted Render secret is read-only."
        )

    with _auth_file_lock:
        if (
            _runtime_auth_initialized
            and RUNTIME_AUTH_FILE.is_file()
            and os.access(RUNTIME_AUTH_FILE, os.R_OK | os.W_OK)
        ):
            return str(RUNTIME_AUTH_FILE)

        try:
            raw_auth = AUTH_FILE.read_bytes()
        except OSError as exc:
            raise RuntimeError("Could not read the mounted YouTube Music auth file.") from exc

        try:
            auth_data = json.loads(raw_auth.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("The YouTube Music auth file is not valid UTF-8 JSON.") from exc

        if not isinstance(auth_data, dict) or not auth_data.get("refresh_token"):
            raise RuntimeError(
                "The YouTube Music OAuth file must contain a refresh_token. "
                "Regenerate the OAuth file with the configured client credentials if necessary."
            )

        runtime_parent = RUNTIME_AUTH_FILE.parent
        try:
            runtime_parent.mkdir(parents=True, exist_ok=True)
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=".ytmusic-oauth-",
                    suffix=".tmp",
                    dir=str(runtime_parent),
                    delete=False,
                ) as runtime_temp:
                    temp_path = Path(runtime_temp.name)
                    os.fchmod(runtime_temp.fileno(), 0o600)
                    runtime_temp.write(raw_auth)
                    runtime_temp.flush()
                    os.fsync(runtime_temp.fileno())

                # Replace atomically so ytmusicapi never sees a partially copied file.
                os.replace(temp_path, RUNTIME_AUTH_FILE)
                os.chmod(RUNTIME_AUTH_FILE, 0o600)
            finally:
                if temp_path is not None and temp_path.exists():
                    temp_path.unlink()
        except OSError as exc:
            raise RuntimeError(
                "Could not create a writable runtime OAuth file. Check "
                "YTMUSIC_RUNTIME_AUTH_FILE and the service's writable filesystem."
            ) from exc

        _runtime_auth_initialized = True
        logger.info(
            "YouTube Music OAuth file prepared in writable runtime storage; "
            "the mounted secret was left unchanged."
        )
        return str(RUNTIME_AUTH_FILE)


def _runtime_directory_writable() -> bool:
    """Test write access without writing any credentials."""
    parent = RUNTIME_AUTH_FILE.parent
    try:
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=".ytmusic-health-check-",
            suffix=".tmp",
            dir=str(parent),
            delete=True,
        ):
            return True
    except OSError:
        return False


def get_client() -> YTMusic:
    if not OAUTH_CLIENT_ID or not OAUTH_CLIENT_SECRET:
        raise RuntimeError("YouTube Music OAuth client credentials are missing.")

    runtime_auth_file = _prepare_runtime_auth_file()
    credentials = OAuthCredentials(
        client_id=OAUTH_CLIENT_ID,
        client_secret=OAUTH_CLIENT_SECRET,
    )
    # Pass the writable copy, not /etc/secrets/ytmusic-oauth.json. On token
    # refresh ytmusicapi may update this runtime file.
    return YTMusic(runtime_auth_file, oauth_credentials=credentials)


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
    # Report presence/configuration only; never return credentials or account data.
    auth_exists = AUTH_FILE.is_file()
    return {
        "ok": True,
        "authConfigured": auth_exists,
        "authReadable": auth_exists and os.access(AUTH_FILE, os.R_OK),
        "runtimeAuthDirectoryWritable": _runtime_directory_writable(),
        "runtimeAuthPrepared": (
            _runtime_auth_initialized
            and RUNTIME_AUTH_FILE.is_file()
            and os.access(RUNTIME_AUTH_FILE, os.R_OK | os.W_OK)
        ),
        "tokenConfigured": bool(SERVICE_TOKEN),
        "oauthConfigured": bool(OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET),
    }


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
            status_code=502,
            detail=(
                f"YouTube Music client initialization failed ({type(exc).__name__}). "
                "Check the companion service logs."
            ),
        ) from exc

    try:
        # get_library_songs() does not include liked songs; use get_liked_songs().
        songs = client.get_liked_songs(limit=LIMIT)
    except Exception as exc:
        logger.exception(
            "YouTube Music liked-song request failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"YouTube Music liked-song request failed ({type(exc).__name__}). "
                "Check the companion service logs for the traceback."
            ),
        ) from exc

    items = []
    for song in songs:
        video_id = song.get("videoId")
        thumbnails = song.get("thumbnails") or []
        artists = [
            artist.get("name", "")
            for artist in (song.get("artists") or [])
            if artist.get("name")
        ]
        items.append(
            Song(
                title=song.get("title") or "Untitled track",
                artists=artists,
                album=(song.get("album") or {}).get("name"),
                thumbnail=thumbnails[-1].get("url") if thumbnails else None,
                url=f"https://music.youtube.com/watch?v={video_id}" if video_id else None,
                videoId=video_id,
            )
        )
    return {"items": items}
