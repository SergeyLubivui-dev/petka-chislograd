# -*- coding: utf-8 -*-
"""Хранилище прогресса. SQLite рядом с исполняемым файлом - приложение портативное."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path


def data_dir() -> Path:
    """Каталог для сохранений: рядом с exe, а в разработке - в корне проекта.

    PETKA_DATA_DIR переопределяет путь - нужно для запуска в контейнере,
    где прогресс лежит на отдельном томе.
    """
    override = os.environ.get("PETKA_DATA_DIR")
    if override:
        path = Path(override)
        path.mkdir(parents=True, exist_ok=True)
        return path
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


DEFAULT = {"chapter": "chapter_01", "collected": [], "hints_used": 0, "seconds_played": 0}


class Storage:
    def __init__(self) -> None:
        self.path = data_dir() / "petka_save.sqlite"
        self._init()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def _init(self) -> None:
        with self._conn() as c:
            c.execute("CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)")

    def load(self) -> dict:
        with self._conn() as c:
            row = c.execute("SELECT payload FROM progress WHERE id = 1").fetchone()
        if not row:
            return dict(DEFAULT)
        try:
            return json.loads(row[0])
        except json.JSONDecodeError:
            return dict(DEFAULT)

    def save(self, payload: dict) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO progress (id, payload) VALUES (1, ?) "
                "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
                (json.dumps(payload, ensure_ascii=False),),
            )
