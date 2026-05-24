import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from starlette.responses import HTMLResponse, Response

from backend.api.routes import router
from backend.database.models import Base
from backend.database.crud import get_engine
from backend.logger import setup_logging, set_correlation_id, get_logger

setup_logging()
logger = get_logger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_engine()
    os.makedirs(os.path.join(BASE_DIR, "uploads"), exist_ok=True)
    yield


app = FastAPI(title="LOD1 Control Evidence Validator", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    cid = request.headers.get("X-Correlation-ID", uuid.uuid4().hex[:12])
    set_correlation_id(cid)
    qs = str(request.url.query)
    logger.debug("%s %s [%s]", request.method, request.url.path, qs if qs else "-")
    start = time.perf_counter()
    response: Response = await call_next(request)
    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "%s %s -> %s (%dms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    response.headers["X-Correlation-ID"] = cid
    return response


templates = Jinja2Templates(directory=os.path.join(FRONTEND_DIR, "templates"))

static_dir = os.path.join(FRONTEND_DIR, "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

app.include_router(router, prefix="/api")


@app.get("/favicon.ico")
async def favicon():
    return Response(content=b"", media_type="image/x-icon")

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)
