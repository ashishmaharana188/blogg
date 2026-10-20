# Blogg YouTube Music bridge

This separate Python service is required because `ytmusicapi` is a Python package. It reads liked songs from the signed-in YouTube Music account and returns only a small normalized list to the Node backend.

## Create the private auth file

Use the setup flow documented by the current ytmusicapi release:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
ytmusicapi oauth
```

If your installed ytmusicapi version exposes the command without the space, use `ytmusicapi oauth`. Follow the CLI prompts, then test that the file reads your liked songs. Never commit `oauth.json`. Browser-header authentication is also supported by ytmusicapi, but browser headers carry session credentials and should be treated like a password.

## Deploy as a separate Render Python Web Service

- Root directory: `backend/ytmusic_service`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Set `YTMUSIC_SERVICE_TOKEN` to a long random value on the Python service.
- Set `YTMUSIC_OAUTH_CLIENT_ID` and `YTMUSIC_OAUTH_CLIENT_SECRET` from the separate TV/Limited Input Devices OAuth client.
- Add `oauth.json` as a Render secret file mounted at `/etc/secrets/ytmusic-oauth.json`.
- Set `YTMUSIC_AUTH_FILE=/etc/secrets/ytmusic-oauth.json`.
- On the existing Node backend, set `YTMUSIC_SERVICE_URL` to this Python service's public HTTPS origin and `YTMUSIC_SERVICE_TOKEN` to the exact same token.

The bridge exposes `GET /liked` only when the matching Bearer token is present. `GET /health` exposes config booleans only, not the token or liked-song data.

## Limitations

ytmusicapi imitates YouTube Music's web interface rather than using an official public YouTube Music API. YouTube can change that interface or invalidate the auth session. If it stops working, re-run the auth setup and replace the Render secret file. Do not send OAuth files or browser headers in chat or store them in Git.
