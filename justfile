# Task runner for the repo. Install `just` (https://just.systems), e.g.
#   uv tool install rust-just     or     cargo install just
# then run `just` to list recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]

# List recipes
default:
    @just --list

# Frontend dev server (http://localhost:5173); builds wasm/deps first if missing
frontend: _frontend-ready
    cd frontend && npm run dev

# Accounts API dev server (http://localhost:8000); needs backend/.env
backend: _backend-env
    cd backend && uv run uvicorn app.main:app --reload

# Run frontend and backend together; Ctrl-C stops both
dev: _frontend-ready _backend-env
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' INT TERM EXIT
    (cd backend && uv run uvicorn app.main:app --reload) &
    (cd frontend && npm run dev) &
    wait

# Apply database migrations to the DATABASE_URL in backend/.env
migrate: _backend-env
    cd backend && uv run alembic upgrade head

# Build the scanner crate to wasm (frontend/src/wasm/)
wasm:
    cd frontend && npm run build:wasm

# Production build of the site (wasm → tsc → vite) into frontend/dist/
build:
    cd frontend && npm run build

# Serve the production build locally
preview: build
    cd frontend && npm run preview

# Run every test suite (scanner, frontend unit, backend)
test: test-scanner test-frontend test-backend

test-scanner:
    cd scanner && cargo test

test-frontend: _frontend-ready
    cd frontend && npm test

test-backend:
    cd backend && uv run pytest

# Playwright e2e against a fresh production build
e2e: build
    cd frontend && npm run test:e2e

# The static checks CI runs (fmt, clippy, lint, typecheck)
check: _frontend-ready
    cd scanner && cargo fmt --check && cargo clippy --all-targets -- -D warnings
    cd frontend && npm run lint && npm run typecheck

# Refresh the committed block list (optionally for a given Minecraft version)
update-blocks *version:
    cd frontend && npm run update:blocks {{ if version == "" { "" } else { "-- " + version } }}

_frontend-ready:
    @[ -d frontend/node_modules ] || (cd frontend && npm ci)
    @[ -f frontend/src/wasm/scanner.js ] || (cd frontend && npm run build:wasm)

_backend-env:
    @[ -f backend/.env ] || { echo "backend/.env missing; copy backend/.env.example and fill it in" >&2; exit 1; }
