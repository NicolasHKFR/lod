import json
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    control_text = Column(Text, nullable=False)
    evidence_text = Column(Text, nullable=True)
    status = Column(String(20), nullable=False)
    confidence_score = Column(Float, nullable=True)
    summary = Column(Text, nullable=True)
    findings = Column(Text, nullable=True)
    gaps = Column(Text, nullable=True)
    raw_prompt = Column(Text, nullable=True)
    raw_llm_response = Column(Text, nullable=True)
    prompt_version = Column(String(10), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    overrides = relationship("Override", back_populates="submission", cascade="all, delete-orphan")


class Override(Base):
    __tablename__ = "overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=False)
    original_status = Column(String(20), nullable=False)
    new_status = Column(String(20), nullable=False)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    submission = relationship("Submission", back_populates="overrides")


class StoredEvidence(Base):
    __tablename__ = "stored_evidence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    extracted_text = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
