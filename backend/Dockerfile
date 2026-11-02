FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# Same uv as wrote uv.lock: an older uv may not read a newer lockfile format.
COPY --from=ghcr.io/astral-sh/uv:0.12.15 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
ENV PATH="/app/.venv/bin:$PATH"

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

# Run unprivileged: nothing here needs root, and a compromise of the app
# should not come with write access to its own code.
RUN useradd --system --no-create-home --uid 10001 app
USER app

EXPOSE 8000
# Migrate on boot: with a single instance there is no race, and it keeps
# deploys to one step. `exec` so uvicorn gets SIGTERM directly.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
