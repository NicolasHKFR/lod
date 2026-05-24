"""Unit tests for the Ollama LLM client."""

import json
import pytest
from backend.engine.ollama_client import _estimate_tokens, _truncate, _parse_response, _fallback


class TestEstimateTokens:
    def test_empty(self):
        assert _estimate_tokens("") == 0

    def test_short_text(self):
        text = "hello world"
        assert _estimate_tokens(text) == len(text) // 4

    def test_long_text(self):
        text = "word " * 1000
        assert _estimate_tokens(text) == len(text) // 4


class TestTruncate:
    def test_no_truncation_needed(self):
        text = "short text"
        assert _truncate(text, 100) == text

    def test_truncation_applied(self):
        text = "A" * 1000
        result = _truncate(text, 50)
        assert len(result) < len(text)
        assert "[...truncated" in result

    def test_very_small_max(self):
        text = "Hello world this is a test"
        result = _truncate(text, 2)
        assert "[...truncated" in result


class TestParseResponse:
    def test_valid_json_direct(self):
        raw = '{"status": "COMPLIANT", "confidence_score": 85, "findings": ["Good"], "gaps_identified": [], "summary": "OK"}'
        result = _parse_response(raw)
        assert result["status"] == "COMPLIANT"
        assert result["confidence_score"] == 85

    def test_valid_json_in_ollama_wrapper(self):
        resp = json.dumps({"response": '{"status": "NON-COMPLIANT", "confidence_score": 90, "findings": [], "gaps_identified": ["Missing"], "summary": "Fail"}'})
        result = _parse_response(resp)
        assert result["status"] == "NON-COMPLIANT"
        assert result["confidence_score"] == 90
        assert "Missing" in result["gaps_identified"]

    def test_json_with_code_block(self):
        raw = '```json\n{"status": "COMPLIANT", "confidence_score": 95, "findings": ["A"], "gaps_identified": [], "summary": "OK"}\n```'
        result = _parse_response(raw)
        assert result["status"] == "COMPLIANT"

    def test_invalid_json_returns_fallback(self):
        raw = "this is not json at all"
        result = _parse_response(raw)
        assert result["status"] == "INCONCLUSIVE"
        assert result["confidence_score"] == 0

    def test_partial_json_uses_fallback(self):
        raw = '{"status": "COMPLIANT"'
        result = _parse_response(raw)
        assert result["status"] == "INCONCLUSIVE"

    def test_invalid_status_mapped_to_inconclusive(self):
        raw = '{"status": "UNKNOWN", "confidence_score": 50, "findings": [], "gaps_identified": [], "summary": ""}'
        result = _parse_response(raw)
        assert result["status"] == "INCONCLUSIVE"


class TestFallback:
    def test_fallback_structure(self):
        result = _fallback()
        assert result["status"] == "INCONCLUSIVE"
        assert result["confidence_score"] == 0
        assert len(result["gaps_identified"]) == 1
