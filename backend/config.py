import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
API_KEY = os.getenv("API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL_NAME = os.getenv("MODEL_NAME", "llama3:8b-instruct-q8_0")
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "60"))

DB_PATH = os.getenv("DB_PATH", os.path.join(BASE_DIR, "lod_audit.db"))

UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", str(50 * 1024 * 1024)))

TESSERACT_CMD = os.getenv("TESSERACT_CMD", "tesseract")

ENDPOINTS_FILE = os.getenv("ENDPOINTS_FILE", os.path.join(ROOT_DIR, "endpoints.txt"))

MAX_TOKENS = int(os.getenv("MAX_TOKENS", "6000"))
PROMPT_VERSION = "2.0"


def load_endpoints():
    if not os.path.isfile(ENDPOINTS_FILE):
        return [OLLAMA_URL]
    with open(ENDPOINTS_FILE, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
    return lines if lines else [OLLAMA_URL]


def save_endpoints(endpoints: list[str]):
    with open(ENDPOINTS_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(endpoints) + "\n")
