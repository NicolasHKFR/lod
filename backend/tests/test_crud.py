"""Unit tests for database CRUD operations."""

import pytest
from backend.database import crud
from backend.database.models import Submission, Override


class TestSaveSubmission:
    def test_save_and_retrieve(self):
        id = crud.save_submission(
            control_text="Test control",
            evidence_text="Test evidence",
            status="COMPLIANT",
            confidence_score=90.0,
            findings=["Finding A"],
            gaps=["Gap A"],
            raw_prompt="prompt",
            raw_llm_response="response",
            prompt_version="2.0",
            summary="Test summary",
        )
        assert id is not None
        sub = crud.get_submission(id)
        assert sub is not None
        assert sub.control_text == "Test control"
        assert sub.status == "COMPLIANT"
        assert sub.confidence_score == 90.0
        assert sub.prompt_version == "2.0"

    def test_save_with_minimal_fields(self):
        id = crud.save_submission(
            control_text="Minimal",
            evidence_text="",
            status="NON-COMPLIANT",
            confidence_score=50.0,
            findings=[],
            gaps=[],
            raw_prompt="",
            raw_llm_response="",
        )
        assert id is not None
        sub = crud.get_submission(id)
        assert sub.status == "NON-COMPLIANT"


class TestOverrides:
    def test_save_override(self):
        id = crud.save_submission(
            control_text="Override test",
            evidence_text="",
            status="COMPLIANT",
            confidence_score=80.0,
            findings=[],
            gaps=[],
            raw_prompt="",
            raw_llm_response="",
        )
        updated = crud.save_override(id, "COMPLIANT", "NON-COMPLIANT", "Manual override")
        assert updated is not None
        sub = crud.get_submission(id)
        assert sub.status == "NON-COMPLIANT"

    def test_override_nonexistent(self):
        result = crud.save_override(99999, "COMPLIANT", "NON-COMPLIANT", "")
        assert result is None


class TestGetAllSubmissions:
    def test_get_all_empty(self):
        results = crud.get_all_submissions(limit=10, offset=0)
        assert isinstance(results, list)

    def test_get_all_with_search(self):
        id = crud.save_submission(
            control_text="UniqueSearchTerm",
            evidence_text="",
            status="COMPLIANT",
            confidence_score=100.0,
            findings=[],
            gaps=[],
            raw_prompt="",
            raw_llm_response="",
        )
        results = crud.get_all_submissions(search="UniqueSearchTerm")
        assert any(s.id == id for s in results)
