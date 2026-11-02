"""The abuse limits in app/limits.py: body size, rates, egress, headers."""

from fastapi.testclient import TestClient

from app.config import get_settings
from app.limits import DailyBudget, Limits, SlidingWindow
from app.main import app

from .test_auth import auth, sign_in
from .test_scans import scan_body


def use_limits(**overrides) -> Limits:
    limits = Limits.from_settings(get_settings().model_copy(update=overrides))
    app.state.limits = limits
    return limits


def test_sliding_window_frees_up_as_hits_age_out() -> None:
    now = [0.0]
    window = SlidingWindow(2, 60, clock=lambda: now[0])
    assert window.hit("a") is None and window.hit("a") is None
    assert window.hit("a") == 60
    assert window.hit("b") is None  # keys are independent
    now[0] = 60.0
    assert window.hit("a") is None


def test_daily_budget_resets_at_the_day_boundary() -> None:
    day = ["2026-11-01"]
    budget = DailyBudget(10, today=lambda: day[0])
    budget.spend(10)
    assert budget.exhausted()
    day[0] = "2026-11-02"
    assert not budget.exhausted()


def test_oversized_body_is_refused_before_parsing(client: TestClient) -> None:
    token = sign_in(client)["token"]
    use_limits(max_body_bytes=100)
    res = client.post("/scans", json=scan_body(), headers=auth(token))
    assert res.status_code == 413


def test_chunked_body_without_length_is_refused(client: TestClient) -> None:
    def chunks():
        yield b'{"credential": "good:alice"}'

    res = client.post("/auth/google", content=chunks(), headers={"Content-Type": "application/json"})
    assert res.status_code == 411


def test_default_body_limit_fits_the_largest_allowed_scan() -> None:
    s = get_settings()
    assert s.max_body_bytes > s.max_scan_bytes * 4 / 3 + 64 * 1024


def test_per_user_rate_limit(client: TestClient) -> None:
    alice, bob = sign_in(client, "alice")["token"], sign_in(client, "bob")["token"]
    use_limits(requests_per_minute_per_user=2)
    assert client.get("/me", headers=auth(alice)).status_code == 200
    assert client.get("/me", headers=auth(alice)).status_code == 200
    res = client.get("/me", headers=auth(alice))
    assert res.status_code == 429 and int(res.headers["retry-after"]) >= 1
    assert client.get("/me", headers=auth(bob)).status_code == 200


def test_sign_in_rate_limit(client: TestClient) -> None:
    use_limits(sign_ins_per_minute=1)
    assert client.post("/auth/google", json={"credential": "good:alice"}).status_code == 200
    assert client.post("/auth/google", json={"credential": "good:bob"}).status_code == 429


def test_oversized_credential_is_rejected(client: TestClient) -> None:
    res = client.post("/auth/google", json={"credential": "good:" + "a" * 5000})
    assert res.status_code == 422


def test_egress_budget_stops_everything_but_health(client: TestClient) -> None:
    token = sign_in(client)["token"]
    use_limits(egress_bytes_per_day=1)
    assert client.get("/me", headers=auth(token)).status_code == 200  # spends it
    res = client.get("/me", headers=auth(token))
    assert res.status_code == 503 and "retry-after" in res.headers
    assert client.get("/health").status_code == 200


def test_refusals_still_carry_cors_headers(client: TestClient) -> None:
    use_limits(max_body_bytes=10)
    res = client.post(
        "/auth/google",
        json={"credential": "good:alice"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert res.status_code == 413
    assert res.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_security_headers(client: TestClient) -> None:
    token = sign_in(client)["token"]
    me = client.get("/me", headers=auth(token))
    assert me.headers["x-content-type-options"] == "nosniff"
    assert me.headers["cache-control"] == "no-store"
    saved = client.post("/scans", json=scan_body(), headers=auth(token)).json()
    coords = client.get(f"/scans/{saved['id']}/coords", headers=auth(token))
    assert "immutable" in coords.headers["cache-control"]  # a route's own choice wins


def test_api_docs_are_not_exposed_by_default(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
