# -*- coding: utf-8 -*-
"""
Запуск игры как настольного приложения: сервер поднимается в фоновом потоке,
окно открывается через pywebview (системный WebView2), без адресной строки.

Именно этот файл собирается в портативный exe:
    pyinstaller --onefile --noconsole --add-data "web;web"
                --add-data "server/content;server/content" run_desktop.py
"""
from __future__ import annotations

import socket
import threading
import time

from server.app import HOST, PORT, app


def wait_for_port(host: str, port: int, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            s.settimeout(0.3)
            if s.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.15)
    return False


def serve() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


def main() -> None:
    threading.Thread(target=serve, daemon=True).start()
    if not wait_for_port(HOST, PORT):
        raise SystemExit("Не удалось запустить локальный сервер")

    import webview

    webview.create_window(
        "Петька и Числоград",
        f"http://{HOST}:{PORT}",
        width=1280,
        height=800,
        min_size=(1024, 640),
        confirm_close=False,
    )
    webview.start()


if __name__ == "__main__":
    main()
