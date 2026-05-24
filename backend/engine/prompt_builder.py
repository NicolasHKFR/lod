from backend.config import PROMPT_VERSION

SYSTEM_PROMPT = """You are an objective compliance assessor. Your task is to assess whether the provided evidence satisfies the control description criteria.

You must return ONLY a valid JSON object with no markdown formatting, no code blocks, no extra text. The JSON must exactly follow this schema:
{
  "status": "COMPLIANT" or "NON-COMPLIANT" or "INCONCLUSIVE",
  "confidence_score": <integer 0-100>,
  "summary": "<1-2 sentence executive summary of the assessment>",
  "findings": ["<positive finding>", ...],
  "gaps_identified": ["<gap or missing element>", ...]
}

Rules:
- COMPLIANT: Evidence reasonably satisfies the control criteria. Default to this when the evidence matches the requirements. You do not need absolute proof — reasonable evidence is sufficient.
- NON-COMPLIANT: Evidence clearly fails to meet one or more specific requirements. Only use this when there is explicit evidence of a failing requirement.
- INCONCLUSIVE: Cannot determine due to insufficient, ambiguous, or missing evidence. Use sparingly.
- confidence_score: How confident you are in the assessment (0-100). High confidence (80+) means the evidence clearly supports the conclusion.
- findings: List specific evidence points that support the control.
- gaps_identified: List specific elements that are missing or insufficient. Empty list if none.

Example:
Control: The firewall change log must record the timestamp of each change.
Evidence: Firewall change log shows: 2025-03-15 14:30 - Rule added for DMZ access.
Assessment: COMPLIANT (confidence 95) — the log entry includes the required timestamp, fully satisfying the control.

Be fair and balanced. If the evidence reasonably addresses the control, mark it COMPLIANT.
"""


def sanitize(text: str) -> str:
    text = text.replace("</", "<\\/")
    return text


def build_prompt(control_text: str, evidence_text: str) -> str:
    safe_control = sanitize(control_text)
    safe_evidence = sanitize(evidence_text)
    user_prompt = f"""<CONTROL_DESCRIPTION>
{safe_control}
</CONTROL_DESCRIPTION>

<EVIDENCE>
{safe_evidence}
</EVIDENCE>

Based on the above control description and evidence, provide your assessment as a JSON object following the specified schema."""
    return user_prompt


def build_full_payload(control_text: str, evidence_text: str) -> dict:
    user_prompt = build_prompt(control_text, evidence_text)
    return {
        "model": None,
        "system": SYSTEM_PROMPT,
        "prompt": user_prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "top_p": 0.9,
        },
    }


def build_openai_messages(control_text: str, evidence_text: str) -> list:
    user_prompt = build_prompt(control_text, evidence_text)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def build_openai_payload(control_text: str, evidence_text: str) -> dict:
    return {
        "model": None,
        "messages": build_openai_messages(control_text, evidence_text),
        "stream": False,
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "top_p": 0.9,
    }
