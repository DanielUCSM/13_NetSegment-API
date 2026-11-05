import re

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_home_serves_frontend_with_local_assets():
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'lang="es"' in response.text
    for path in re.findall(r'(?:src|href)="(/assets/[^"#]+)"', response.text):
        asset = client.get(path)
        assert asset.status_code == 200, path
        assert asset.content
    assert 'http' not in " ".join(re.findall(r'<script[^>]*src="([^"]+)"', response.text))


@pytest.mark.parametrize("path,mime", [
    ("app.js", "javascript"), ("network.js", "javascript"),
    ("styles.css", "text/css"), ("favicon.svg", "image/svg+xml"),
])
def test_asset_types_and_files(path, mime):
    response = client.get(f"/assets/{path}")
    assert response.status_code == 200
    assert mime in response.headers["content-type"]


def test_static_mount_does_not_replace_api_or_expose_repository():
    assert client.get("/assets/requirements.txt").status_code == 404
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/.env").status_code == 404
    assert client.get("/frontend/tests/network.test.js").status_code == 404
    assert client.get("/missing").status_code == 404
    assert client.get("/health").json()["status"] == "ok"
    assert client.post("/api/v1/subnetting/flsm", json={
        "network": "192.168.10.0/24", "subnets_needed": 4,
    }).json()["data"]["allocated_subnets_count"] == 4


def test_frontend_works_from_a_different_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert client.get("/").status_code == 200
    assert client.get("/assets/app.js").status_code == 200
