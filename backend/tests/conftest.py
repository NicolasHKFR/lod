"""Pytest configuration and fixtures."""

import os
import tempfile
import pytest
from backend.database import crud


@pytest.fixture(autouse=True)
def use_temp_db(monkeypatch):
    """Use a temporary SQLite database for each test session."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setattr("backend.config.DB_PATH", tmp.name)
    # Reset cached engine/session
    crud._engine = None
    crud._SessionLocal = None
    yield
    os.unlink(tmp.name)
