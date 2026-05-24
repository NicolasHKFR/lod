"""Integration tests for API routes."""

import json
import pytest
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


class TestHealth:
    def test_health_endpoint(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data
        assert "llm_connected" in data
        assert "db_connected" in data
        assert "ocr_available" in data
        assert "pdf_extraction" in data


class TestConfig:
    def test_get_config_defaults(self):
        resp = client.get("/api/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "model" in data
        assert "timeout" in data
        assert "max_tokens" in data
        assert "endpoints" in data

    def test_update_config(self):
        resp = client.post("/api/config", json={
            "model": "test-model",
            "timeout": 30,
            "max_tokens": 2000,
            "endpoints": ["http://localhost:11434/api/generate"],
        })
        assert resp.status_code == 200

    def test_get_endpoints(self):
        resp = client.get("/api/endpoints")
        assert resp.status_code == 200
        assert "endpoints" in resp.json()


class TestEndpoints:
    def test_index_serves_html(self):
        resp = client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]

    def test_favicon(self):
        resp = client.get("/favicon.ico")
        assert resp.status_code == 200
        assert resp.content == b""
