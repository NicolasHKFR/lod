"""Unit tests for the prompt builder."""

from backend.engine.prompt_builder import sanitize, build_prompt, build_full_payload, SYSTEM_PROMPT


class TestSanitize:
    def test_normal_text_unchanged(self):
        text = "Hello world"
        assert sanitize(text) == text

    def test_closing_tag_escaped(self):
        text = "text </CONTROL> more"
        assert sanitize(text) == "text <\\/CONTROL> more"

    def test_no_opening_tag_affected(self):
        text = "<CONTROL>text</CONTROL>"
        result = sanitize(text)
        assert "<CONTROL>" in result
        assert "<\\/CONTROL>" in result


class TestBuildPrompt:
    def test_prompt_contains_control(self):
        prompt = build_prompt("My control", "My evidence")
        assert "<CONTROL_DESCRIPTION>" in prompt
        assert "My control" in prompt
        assert "<EVIDENCE>" in prompt
        assert "My evidence" in prompt

    def test_prompt_ends_with_assessment_instruction(self):
        prompt = build_prompt("c", "e")
        assert prompt.strip().endswith("JSON object following the specified schema.")

    def test_empty_control(self):
        prompt = build_prompt("", "evidence")
        assert "<CONTROL_DESCRIPTION>" in prompt


class TestBuildFullPayload:
    def test_returns_dict_with_required_keys(self):
        payload = build_full_payload("control", "evidence")
        assert "model" in payload
        assert "system" in payload
        assert "prompt" in payload
        assert "options" in payload

    def test_system_prompt_contains_compliant_bias(self):
        payload = build_full_payload("control", "evidence")
        assert "COMPLIANT" in payload["system"]
        assert "objective compliance assessor" in payload["system"]

    def test_system_prompt_v2(self):
        payload = build_full_payload("control", "evidence")
        assert payload["system"] == SYSTEM_PROMPT

    def test_options_set(self):
        payload = build_full_payload("control", "evidence")
        assert payload["options"]["temperature"] == 0.1
        assert payload["format"] == "json"
