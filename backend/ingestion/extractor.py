import os
import logging

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".csv", ".log", ".png", ".jpg", ".jpeg"}

PDF_MAGIC = b"%PDF"
PNG_MAGIC = b"\x89PNG"
JPEG_MAGIC = b"\xff\xd8\xff"


def detect_mime(path: str) -> str:
    with open(path, "rb") as f:
        header = f.read(4)
    if header[:4] == b"%PDF":
        return "application/pdf"
    if header[:4] == PNG_MAGIC:
        return "image/png"
    if header[:3] == JPEG_MAGIC:
        return "image/jpeg"
    try:
        with open(path, "r", encoding="utf-8") as f:
            f.read(256)
        return "text/plain"
    except (UnicodeDecodeError, Exception):
        return "application/octet-stream"


def extract_text(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    detected = detect_mime(file_path)
    ext_map = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }
    expected = ext_map.get(ext, "text/plain")
    if detected != expected and not (detected == "text/plain" and ext in (".txt", ".md", ".csv", ".log")):
        logger.warning(f"MIME mismatch for {file_path}: extension suggests {expected}, detected {detected}")

    if ext in (".txt", ".md", ".csv", ".log"):
        return _extract_plain_text(file_path)
    elif ext == ".pdf":
        return _extract_pdf_text(file_path)
    elif ext in (".png", ".jpg", ".jpeg"):
        return _extract_image_text(file_path)
    else:
        raise ValueError(f"No handler for: {ext}")


def _extract_plain_text(file_path: str) -> str:
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _extract_pdf_text(file_path: str) -> str:
    import fitz
    doc = fitz.open(file_path)
    text_parts = []
    for page in doc:
        text_parts.append(page.get_text())
    doc.close()
    combined = "\n".join(text_parts).strip()
    if not combined:
        combined = _ocr_image(file_path)
    return combined


def _extract_image_text(file_path: str) -> str:
    return _ocr_image(file_path)


def _ocr_image(file_path: str) -> str:
    try:
        import pytesseract
        from PIL import Image
        pytesseract.pytesseract.tesseract_cmd = _find_tesseract()
        image = Image.open(file_path)
        text = pytesseract.image_to_string(image)
        return text.strip()
    except Exception as e:
        logger.warning(f"OCR failed for {file_path}: {e}")
        return ""


def _find_tesseract() -> str:
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        "tesseract",
    ]
    for c in candidates:
        if os.path.exists(c) or c == "tesseract":
            return c
    return "tesseract"
