# -*- coding: utf-8 -*-
"""
Петька и Числоград - локальный сервер разработки.

Отдаёт клиент (HTML/CSS/JS + ассеты) и небольшой REST API:
    GET  /api/chapters        - список глав: номер, название, жанр, цена, иконка
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
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .storage import Storage

HOST = "127.0.0.1"
PORT = 6244

# Поля главы, которые нужны экрану выбора: остальное (декорации, диалоги)
# грузится, когда глава открыта.
CHAPTER_META = (
    "id", "number", "title", "subtitle", "summary", "icon", "cost", "skills", "rewards",
)


def base_dir() -> Path:
    """Корень ресурсов. Работает и из исходников, и из собранного PyInstaller exe."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent


BASE = base_dir()
WEB = BASE / "web"
CONTENT = BASE / "server" / "content"

app = FastAPI(title="Petka Numbertown", version="0.2.0", docs_url=None, redoc_url=None)
storage = Storage()


def safe_name(name: str) -> str:
    return "".join(ch for ch in name if ch.isalnum() or ch in "_-")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": app.version}


@app.get("/api/chapters")
def chapters() -> JSONResponse:
    """Все главы `chapter_*.json` по возрастанию номера - для экрана выбора."""
    items = []
    for path in sorted(CONTENT.glob("chapter_*.json")):
        try:
            data = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        meta = {k: data[k] for k in CHAPTER_META if k in data}
        meta.setdefault("id", path.stem)
        meta.setdefault("number", len(items) + 1)
        meta["pickups"] = len(data.get("pickups", []))
        meta["gates"] = len(data.get("gates", []))
        items.append(meta)
    items.sort(key=lambda m: m.get("number", 0))
    return JSONResponse(items)


@app.get("/api/content/{name}")
def content(name: str) -> JSONResponse:
    path = CONTENT / f"{safe_name(name)}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="content not found")
    return JSONResponse(read_json(path))


@app.post("/api/content/{name}")
def save_content(name: str, payload: dict) -> dict:
    """Сохранение главы из встроенного редактора (режим разработки)."""
    path = CONTENT / f"{safe_name(name)}.json"
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
def set_progress(payload: dict) -> dict:
    """Прогресс - произвольный JSON-документ клиента (формат описан в web/js/core/Progress.js)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="progress must be an object")
    storage.save(payload)
    return {"ok": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


# Визуальный редактор уровней - отдельная страница разработчика.
# Кириллический алиас работает и в url-кодированном виде: ASGI отдаёт путь
# уже раскодированным, поэтому /%D1%80%D0%B5%D0%B4... попадает в тот же маршрут.
@app.get("/editor")
@app.get("/editor/")
@app.get("/редактор")
@app.get("/редактор/")
def editor_page() -> FileResponse:
    return FileResponse(WEB / "editor.html")


app.mount("/", StaticFiles(directory=str(WEB), html=True), name="web")


def run() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
