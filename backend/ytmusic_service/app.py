import logging
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from ytmusicapi import OAuthCredentials, YTMusic

app = FastAPI(title="Blogg YouTube Music Bridge")
logger = logging.getLogger("uvicorn.error")
SERVICE_TOKEN = os.getenv("YTMUSIC_SERVICE_TOKEN", "").strip()
AUTH_FILE = os.getenv("YTMUSIC_AUTH_FILE", "/etc/secrets/ytmusic-oauth.json")
OAUTH_CLIENT_ID = os.getenv("YTMUSIC_OAUTH_CLIENT_ID", "").strip()
OAUTH_CLIENT_SECRET = os.getenv("YTMUSIC_OAUTH_CLIENT_SECRET", "").strip()
LIMIT = max(1, min(int(os.getenv("YTMUSIC_LIKED_LIMIT", "25")), 50))


def get_client() -> YTMusic:
    if not os.path.isfile(AUTH_FILE):
        raise RuntimeError("YouTube Music auth file is missing.")
    if not OAUTH_CLIENT_ID or not OAUTH_CLIENT_SECRET:
        raise RuntimeError("YouTube Music OAuth client credentials are missing.")
    credentials = OAuthCredentials(client_id=OAUTH_CLIENT_ID, client_secret=OAUTH_CLIENT_SECRET)
    return YTMusic(AUTH_FILE, oauth_credentials=credentials)


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
    return {
        "ok": True,
        "authConfigured": os.path.isfile(AUTH_FILE),
        "authReadable": os.path.isfile(AUTH_FILE) and os.access(AUTH_FILE, os.R_OK),
        "tokenConfigured": bool(SERVICE_TOKEN),
        "oauthConfigured": bool(OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET),
    }


@app.get("/liked", response_model=SongList)
def liked(authorization: Optional[str] = Header(default=None)):
    if not SERVICE_TOKEN or authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Keep client construction separate from the upstream request. The old broad
    # handler returned only "OSError", which made file/credential setup failures
    # indistinguishable from DNS/TLS/network failures while fetching liked songs.
    try:
        client = get_client()
    except Exception as exc:
        logger.exception(
            "YouTube Music client initialization failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=f"YouTube Music client initialization failed ({type(exc).__name__}). Check the companion service logs.",
        ) from exc

    try:
        # get_library_songs() does not include liked songs; this endpoint must use
        # get_liked_songs(). ytmusicapi's network/auth exceptions are logged server-side
        # for diagnosis, without logging request headers, tokens, or OAuth file contents.
        songs = client.get_liked_songs(limit=LIMIT)
    except Exception as exc:
        logger.exception(
            "YouTube Music liked-song request failed; error_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail=f"YouTube Music liked-song request failed ({type(exc).__name__}). Check the companion service logs for the traceback.",
        ) from exc

    items = []
    for song in songs:
        video_id = song.get("videoId")
        thumbnails = song.get("thumbnails") or []
        artists = [artist.get("name", "") for artist in (song.get("artists") or []) if artist.get("name")]
        items.append(Song(
            title=song.get("title") or "Untitled track",
            artists=artists,
            album=(song.get("album") or {}).get("name"),
            thumbnail=thumbnails[-1].get("url") if thumbnails else None,
            url=f"https://music.youtube.com/watch?v={video_id}" if video_id else None,
            videoId=video_id,
        ))
    return {"items": items}
