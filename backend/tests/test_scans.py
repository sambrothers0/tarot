import base64

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import get_settings
from app.main import app
from app.models import SavedScan

from .test_auth import auth, sign_in


def scan_body(**overrides) -> dict:
    body = {
        "block_type": "minecraft:nether_portal",
        "dimension": "nether",
        "source_kind": "zip",
        "source_name": "Survival.zip",
        "scanned_at": "2026-11-01T12:00:00Z",
        "count": 3,
        "truncated": False,
        "preview": [[1, 2], [3, 4]],
        "coords": base64.b64encode(b"packed-bytes").decode(),
    }
    return body | overrides


def test_save_list_read_delete(client: TestClient) -> None:
    token = sign_in(client)["token"]
    res = client.post("/scans", json=scan_body(), headers=auth(token))
    assert res.status_code == 201, res.text
    saved = res.json()
    assert saved["preview"] == [[1, 2], [3, 4]]
    assert "coords" not in saved

    listed = client.get("/scans", headers=auth(token)).json()
    assert [s["id"] for s in listed] == [saved["id"]]
    assert listed[0]["scanned_at"].startswith("2026-11-01T12:00:00")

    coords = client.get(f"/scans/{saved['id']}/coords", headers=auth(token))
    assert coords.status_code == 200
    assert coords.content == b"packed-bytes"
    assert "immutable" in coords.headers["cache-control"]

    assert client.delete(f"/scans/{saved['id']}", headers=auth(token)).status_code == 204
    assert client.get("/scans", headers=auth(token)).json() == []
    assert client.delete(f"/scans/{saved['id']}", headers=auth(token)).status_code == 404


def test_list_is_newest_scan_first(client: TestClient) -> None:
    token = sign_in(client)["token"]
    for day in ("01", "03", "02"):
        client.post("/scans", json=scan_body(scanned_at=f"2026-10-{day}T00:00:00Z"), headers=auth(token))
    days = [s["scanned_at"][:10] for s in client.get("/scans", headers=auth(token)).json()]
    assert days == ["2026-10-03", "2026-10-02", "2026-10-01"]


def test_scans_are_private_to_their_owner(client: TestClient) -> None:
    alice = sign_in(client, "alice")["token"]
    bob = sign_in(client, "bob")["token"]
    scan_id = client.post("/scans", json=scan_body(), headers=auth(alice)).json()["id"]

    assert client.get("/scans", headers=auth(bob)).json() == []
    assert client.get(f"/scans/{scan_id}/coords", headers=auth(bob)).status_code == 404
    assert client.delete(f"/scans/{scan_id}", headers=auth(bob)).status_code == 404
    assert client.get(f"/scans/{scan_id}/coords", headers=auth(alice)).status_code == 200


def test_requires_sign_in(client: TestClient) -> None:
    assert client.get("/scans").status_code == 401
    assert client.post("/scans", json=scan_body()).status_code == 401


def test_rejects_bad_input(client: TestClient) -> None:
    token = sign_in(client)["token"]
    for bad in (
        {"dimension": "aether"},
        {"source_kind": "rar"},
        {"count": -1},
        {"preview": [[0, 0]] * 65},
        {"preview": [[40_000_000, 0]]},
        {"block_type": ""},
    ):
        assert client.post("/scans", json=scan_body(**bad), headers=auth(token)).status_code == 422, bad


def test_quotas(client: TestClient, db_factory) -> None:
    settings = get_settings().model_copy(
        update={
            "max_scans_per_user": 2,
            "max_scan_bytes": 10,
            "max_scan_bytes_per_user": 15,
            "max_scan_bytes_total": 25,
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    blob = lambda n: base64.b64encode(b"x" * n).decode()  # noqa: E731

    alice = sign_in(client, "alice")["token"]
    assert client.post("/scans", json=scan_body(coords=blob(11)), headers=auth(alice)).status_code == 413
    assert client.post("/scans", json=scan_body(coords=blob(10)), headers=auth(alice)).status_code == 201
    # Per-user bytes: 10 + 6 > 15.
    assert client.post("/scans", json=scan_body(coords=blob(6)), headers=auth(alice)).status_code == 507
    assert client.post("/scans", json=scan_body(coords=blob(5)), headers=auth(alice)).status_code == 201
    # Per-user count: already 2.
    assert client.post("/scans", json=scan_body(coords=blob(0)), headers=auth(alice)).status_code == 507

    # Everyone's total: 15 + 10 + 1 > 25.
    bob = sign_in(client, "bob")["token"]
    assert client.post("/scans", json=scan_body(coords=blob(10)), headers=auth(bob)).status_code == 201
    assert client.post("/scans", json=scan_body(coords=blob(1)), headers=auth(bob)).status_code == 507

    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(SavedScan)) == 3


def test_deleting_the_account_deletes_its_scans(client: TestClient, db_factory) -> None:
    token = sign_in(client)["token"]
    client.post("/scans", json=scan_body(), headers=auth(token))
    assert client.delete("/me", headers=auth(token)).status_code == 204
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(SavedScan)) == 0


def test_rename(client: TestClient) -> None:
    alice = sign_in(client, "alice")["token"]
    bob = sign_in(client, "bob")["token"]
    scan_id = client.post("/scans", json=scan_body(), headers=auth(alice)).json()["id"]
    assert client.get("/scans", headers=auth(alice)).json()[0]["name"] is None

    res = client.patch(f"/scans/{scan_id}", json={"name": "  Base portals "}, headers=auth(alice))
    assert res.status_code == 200 and res.json()["name"] == "Base portals"
    assert client.get("/scans", headers=auth(alice)).json()[0]["name"] == "Base portals"

    # Blank clears it; other people's scans are invisible; length is bounded.
    assert client.patch(f"/scans/{scan_id}", json={"name": "  "}, headers=auth(alice)).json()["name"] is None
    assert client.patch(f"/scans/{scan_id}", json={"name": "x"}, headers=auth(bob)).status_code == 404
    assert client.patch(f"/scans/{scan_id}", json={"name": "x" * 101}, headers=auth(alice)).status_code == 422
