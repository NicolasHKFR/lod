import json
from datetime import datetime, timezone
from sqlalchemy import create_engine, select, or_, and_
from sqlalchemy.orm import sessionmaker

from backend.config import DB_PATH
from backend.database.models import Base, Submission, Override, StoredEvidence


_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
        Base.metadata.create_all(_engine)
    return _engine


def get_session():
    global _SessionLocal
    if _SessionLocal is None:
        engine = get_engine()
        _SessionLocal = sessionmaker(bind=engine)
    return _SessionLocal()


def save_submission(control_text, evidence_text, status, confidence_score, findings, gaps, raw_prompt, raw_llm_response, prompt_version=None, summary=None):
    session = get_session()
    try:
        sub = Submission(
            control_text=control_text,
            evidence_text=evidence_text,
            status=status,
            confidence_score=confidence_score,
            findings=json.dumps(findings) if findings else None,
            gaps=json.dumps(gaps) if gaps else None,
            raw_prompt=raw_prompt,
            raw_llm_response=raw_llm_response,
            prompt_version=prompt_version,
            summary=summary,
        )
        session.add(sub)
        session.commit()
        session.refresh(sub)
        return sub.id
    finally:
        session.close()


def get_submission(submission_id: int):
    session = get_session()
    try:
        return session.execute(
            select(Submission).where(Submission.id == submission_id)
        ).scalar_one_or_none()
    finally:
        session.close()


def get_all_submissions(limit=50, offset=0, search=None, status=None, date_from=None, date_to=None):
    session = get_session()
    try:
        query = select(Submission)
        filters = []
        if search:
            filters.append(Submission.control_text.ilike(f"%{search}%"))
        if status:
            filters.append(Submission.status == status.upper())
        if date_from:
            filters.append(Submission.created_at >= date_from)
        if date_to:
            filters.append(Submission.created_at <= date_to)
        if filters:
            query = query.where(and_(*filters))
        query = query.order_by(Submission.created_at.desc()).limit(limit).offset(offset)
        rows = session.execute(query).scalars().all()
        return rows
    finally:
        session.close()


def clear_database():
    session = get_session()
    try:
        session.query(Override).delete()
        session.query(Submission).delete()
        session.commit()
        return True
    except:
        session.rollback()
        return False
    finally:
        session.close()


def save_evidence(filename, original_filename, file_size, mime_type, extracted_text, tags=None):
    session = get_session()
    try:
        ev = StoredEvidence(
            filename=filename,
            original_filename=original_filename,
            file_size=file_size,
            mime_type=mime_type,
            extracted_text=extracted_text,
            tags=json.dumps(tags) if tags else None,
        )
        session.add(ev)
        session.commit()
        session.refresh(ev)
        return ev
    finally:
        session.close()


def get_all_evidence(search=None, tag=None, limit=100, offset=0):
    session = get_session()
    try:
        query = select(StoredEvidence)
        filters = []
        if search:
            filters.append(StoredEvidence.original_filename.ilike(f"%{search}%"))
        if tag:
            filters.append(StoredEvidence.tags.ilike(f"%{tag}%"))
        if filters:
            query = query.where(and_(*filters))
        query = query.order_by(StoredEvidence.created_at.desc()).limit(limit).offset(offset)
        return session.execute(query).scalars().all()
    finally:
        session.close()


def get_evidence(evidence_id):
    session = get_session()
    try:
        return session.execute(
            select(StoredEvidence).where(StoredEvidence.id == evidence_id)
        ).scalar_one_or_none()
    finally:
        session.close()


def delete_evidence(evidence_id):
    session = get_session()
    try:
        ev = session.execute(
            select(StoredEvidence).where(StoredEvidence.id == evidence_id)
        ).scalar_one_or_none()
        if not ev:
            return False
        session.delete(ev)
        session.commit()
        return True
    finally:
        session.close()


def update_evidence_tags(evidence_id, tags):
    session = get_session()
    try:
        ev = session.execute(
            select(StoredEvidence).where(StoredEvidence.id == evidence_id)
        ).scalar_one_or_none()
        if not ev:
            return None
        ev.tags = json.dumps(tags)
        session.commit()
        return ev
    finally:
        session.close()


def save_override(submission_id: int, original_status: str, new_status: str, reason: str):
    session = get_session()
    try:
        sub = session.execute(
            select(Submission).where(Submission.id == submission_id)
        ).scalar_one_or_none()
        if not sub:
            return None
        sub.status = new_status
        ovr = Override(
            submission_id=submission_id,
            original_status=original_status,
            new_status=new_status,
            reason=reason,
        )
        session.add(ovr)
        session.commit()
        return sub
    finally:
        session.close()
