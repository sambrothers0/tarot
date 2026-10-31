# Tarot accounts API

Optional FastAPI service behind Tarot's "Sign in with Google". It knows who you
are and nothing else: **no save, path or scan result is ever sent here.** The
frontend works fully without it.

Stack: FastAPI · SQLAlchemy 2 (sync, psycopg 3) · Alembic · Neon Postgres ·
hosted on a Koyeb free instance.

## API

| Method | Path | Auth | |
|---|---|---|---|
| GET | `/healthz` | — | Health check / wake-up ping. Never touches the DB. |
| POST | `/auth/google` | — | `{credential}` (Google ID token) → `{token, expires_at, user}`. First sign-in creates the account. |
| POST | `/auth/logout` | bearer | Revoke this session. 204. |
| GET | `/me` | bearer | The signed-in user. |
| DELETE | `/me` | bearer | Delete the account; sessions cascade. 204. |

Interactive docs at `/docs` when running.

**Sessions.** The backend verifies Google's ID token once (signature, audience =
`GOOGLE_CLIENT_ID`, `email_verified`), then issues its own random bearer token
(30 days). Only its SHA-256 is stored, so a database leak leaks no live
sessions. Bearer tokens rather than cookies because the frontend (`github.io`)
and the API (`koyeb.app`) are different sites, where a cookie would be
third-party and blocked. Expired sessions are swept on each sign-in.

## Local development

```bash
cp .env.example .env      # fill in DATABASE_URL and GOOGLE_CLIENT_ID
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload     # http://localhost:8000
uv run pytest                            # SQLite in-memory, Google stubbed
```

Frontend side: create `frontend/.env.local` with

```
VITE_API_URL=http://localhost:8000
VITE_GOOGLE_CLIENT_ID=<same client ID>
```

A new migration: `uv run alembic revision --autogenerate -m "…"`, then review it.

## One-time setup

### Google
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client
   ID** → *Web application*. (Configure the consent screen first if asked:
   External, scopes `email`, `profile`, `openid`.)
2. **Authorized JavaScript origins**: `https://<you>.github.io` and
   `http://localhost:5173`. No redirect URIs needed.
3. Copy the client ID. It is public; there is no client secret in this flow.

### Neon
1. Create a project and database.
2. Copy the **direct** connection string (not the `-pooler` host), keeping
   `sslmode=require`. The `postgresql://` prefix is rewritten to psycopg 3
   automatically.

### Koyeb
1. Create a Web Service from this GitHub repo, builder **Dockerfile**, work
   directory `backend`.
2. Environment variables: `DATABASE_URL` (as a Koyeb secret),
   `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGINS=https://<you>.github.io`.
3. Port 8000, health check `GET /healthz`.
4. Migrations run on every boot (`alembic upgrade head`), so a deploy is the
   whole release.

### GitHub Pages
Set repository variables `VITE_API_URL` (the Koyeb URL) and
`VITE_GOOGLE_CLIENT_ID`; the deploy workflow passes them to the build.

## Free-tier behaviour

Koyeb scales the instance to zero when idle and Neon suspends the database, so
the first request after a quiet spell is slow. The frontend pings `/healthz` on
page load so the server is usually warm by the time anyone signs in;
`pool_pre_ping` recovers the connections Neon drops while suspended.
