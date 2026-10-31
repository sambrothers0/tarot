from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import auth, me


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Tarot accounts API", version="0.1.0")

    # Bearer tokens, not cookies: the frontend (github.io) and this API are
    # different sites, so a session cookie would be a third-party cookie.
    # That also means credentials are off and there is no CSRF surface.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/healthz", tags=["health"])
    def healthz() -> dict[str, str]:
        # No database call: this is both Koyeb's health check and the
        # frontend's wake-up ping, and neither should wake Neon.
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(me.router)
    return app


app = create_app()
