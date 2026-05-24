from typing import Optional, Literal
from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    control_text: Optional[str] = None


class AnalyzeResponse(BaseModel):
    id: int
    status: str
    confidence_score: float
    findings: list[str]
    gaps_identified: list[str]


class OverrideRequest(BaseModel):
    new_status: str
    reason: Optional[str] = None


class SubmissionItem(BaseModel):
    id: int
    control_text: str
    status: str
    confidence_score: Optional[float]
    findings: Optional[list[str]]
    gaps: Optional[list[str]]
    summary: Optional[str]
    prompt_version: Optional[str]
    created_at: str


class HistoryResponse(BaseModel):
    submissions: list[SubmissionItem]


class LLMOutput(BaseModel):
    status: Literal["COMPLIANT", "NON-COMPLIANT", "INCONCLUSIVE"]
    confidence_score: int = Field(ge=0, le=100, default=0)
    findings: list[str] = Field(default_factory=list)
    gaps_identified: list[str] = Field(default_factory=list)
    summary: str = ""
