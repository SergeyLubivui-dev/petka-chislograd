# Петька и Числоград

Обучающая 2D-адвенчура для детей 6+. Прототип первой главы «Часовая площадь».

## Стек

| Слой | Технология |
|---|---|
| Клиент | HTML + CSS + JavaScript (ES-модули), отрисовка через Canvas 2D API, без игровых движков |
| Шрифт | Comfortaa (округлый, с кириллицей), зашит в проект как woff2 |
| Анимации UI | Transitions.dev: resize, shimmer, stream - в CSS и в порте на канвас |
| Сервер | Python 3.11, FastAPI + Uvicorn |
| Данные | SQLite (прогресс), JSON (содержание глав) |
| Окно приложения | pywebview / WebView2 — в релизной сборке |
| Сборка | PyInstaller, один портативный exe |

## Запуск в разработке

Двойным щелчком:

```
start.bat
```

Скрипт сам создаст `.venv`, поставит зависимости, поднимет сервер и откроет браузер.

Вручную:

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn server.app:app --host 127.0.0.1 --port 6244 --reload
```

Открыть: **http://127.0.0.1:6244**

## Структура

```
petka-game/
├─ start.bat                 запуск сервера разработки на порту 6244
├─ requirements.txt
├─ ARCHITECTURE.md           сценарий, поток сцен, логика, соглашения
├─ server/
│  ├─ app.py                 FastAPI: статика + REST API
│  ├─ storage.py             прогресс в SQLite рядом с exe (портативность)
│  └─ content/
│     └─ chapter_01.json     сценарий и данные первой главы
└─ web/
   ├─ index.html
   ├─ css/style.css
   ├─ css/transitions.css    эффекты Transitions.dev (resize / shimmer / stream)
   ├─ js/
   │  ├─ main.js             точка входа, игровой цикл
   │  ├─ core/               Viewport, Input, Atlas, Loader, SceneManager, ui,
   │  │                      Dialogue (диалоги и головоломки), Editor (редактор сцены),
   │  │                      motion (порт Transitions.dev на канвас)
   │  └─ scenes/             MenuScene, StoryScene, GameScene
   └─ assets/
      ├─ atlas/atlas.png     атлас спрайтов 2048x2048
      ├─ atlas/atlas.json    карта кадров
      ├─ fonts/              Comfortaa woff2
      └─ bg/                 menu.png, far.png
```

## Управление

| Действие | Клавиши |
|---|---|
| Идти | ← → или A D |
| Прыжок | Пробел, ↑, W |
| Поговорить с НПС | E (когда рядом появилась подсказка) |
| Выбор темы / ответа | 1, 2, 3 или клик мышью |
| Подтвердить / дальше | Пробел, Enter, клик мышью |
| Подсказка | кнопка «?» |
| Назад, закрыть | Esc |
| В меню | кнопка «⌂» или Esc |

### Редактор сцены (режим отладки)

| Действие | Клавиши |
|---|---|
| Включить / выключить | F2 |
| Двигать объект | зажать ЛКМ и тянуть |
| Точный сдвиг | стрелки (Shift — шаг 10) |
| Масштаб объекта | [ и ] |
| Отразить по горизонтали | F |
| Сетка и линия пола | G |
| Двигать камеру | A / D |
| Сохранить главу на диск | Ctrl+S |

## API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | проверка живости |
| GET | `/api/content/{name}` | сценарий и данные главы |
| POST | `/api/content/{name}` | сохранение главы из редактора (только в разработке) |
| GET | `/api/progress` | текущий прогресс |
| POST | `/api/progress` | сохранить прогресс |

## Сборка портативного exe

```bat
pip install pyinstaller
pyinstaller --noconfirm --onefile --noconsole ^
  --name "PetkaChislograd" ^
  --add-data "web;web" ^
  --add-data "server/content;server/content" ^
  run_desktop.py
```

Файл сохранений (`petka_save.sqlite`) создаётся рядом с exe, поэтому приложение
остаётся портативным: копируется на флешку и запускается без установки.
