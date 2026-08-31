# -*- coding: utf-8 -*-
"""
Петька и Числоград - локальный сервер разработки.

Отдаёт клиент (HTML/CSS/JS + ассеты) и небольшой REST API:
    GET  /api/content/{name}  - сценарий и данные главы
    POST /api/content/{name}  - сохранение главы из редактора (только в разработке)
    GET  /api/progress        - текущий прогресс
    POST /api/progress        - сохранить прогресс
    GET  /api/health          - проверка живости

Запуск в разработке:  python -m server.app        (127.0.0.1:6244)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .storage import Storage

HOST = "127.0.0.1"
PORT = 6244


def base_dir() -> Path:
    """Корень ресурсов. Работает и из исходников, и из собранного PyInstaller exe."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


BASE = base_dir()
WEB = BASE / "web"
CONTENT = BASE / "server" / "content"

app = FastAPI(title="Petka Numbertown", version="0.1.0", docs_url=None, redoc_url=None)
storage = Storage()


class Progress(BaseModel):
    chapter: str = "chapter_01"
    collected: list[str] = Field(default_factory=list)
    hints_used: int = 0
    seconds_played: int = 0


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": app.version}


@app.get("/api/content/{name}")
def content(name: str) -> JSONResponse:
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "_-")
    path = CONTENT / f"{safe}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="content not found")
    return JSONResponse(json.loads(path.read_text(encoding="utf-8")))


@app.post("/api/content/{name}")
def save_content(name: str, payload: dict) -> dict:
    """Сохранение главы из встроенного редактора (режим разработки)."""
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "_-")
    path = CONTENT / f"{safe}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="content not found")
    if getattr(sys, "frozen", False):
        raise HTTPException(status_code=403, detail="editor disabled in release build")
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "saved": path.name}


@app.get("/api/progress")
def get_progress() -> dict:
    return storage.load()


@app.post("/api/progress")
def set_progress(data: Progress) -> dict:
    storage.save(data.model_dump())
    return {"ok": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")


def run() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
