from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .limits import GuardMiddleware, Limits
from .routes import auth, me, scans


def create_app() -> FastAPI:
    settings = get_settings()
    docs = settings.expose_docs
    app = FastAPI(
        title="Tarot accounts API",
        version="0.1.0",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.limits = Limits.from_settings(settings)

    # Added first so it sits *inside* CORS: its 411/413/503 replies still get
    # CORS headers, so the browser can read why it was refused.
    app.add_middleware(GuardMiddleware, get_limits=lambda: app.state.limits)

    # Bearer tokens, not cookies: the frontend (github.io) and this API are
    # different sites, so a session cookie would be a third-party cookie.
    # That also means credentials are off and there is no CSRF surface.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        # No database call: this is both a health check and the
        # frontend's wake-up ping, and neither should wake Neon.
        # Not /healthz: Cloud Run reserves paths ending in "z".
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(scans.router)
    return app


app = create_app()
