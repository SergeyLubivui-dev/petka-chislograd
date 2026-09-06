# -*- coding: utf-8 -*-
"""
Проверка глав: server/content/chapter_*.json против атласа и правил движка.

Запуск:  python tools/check_chapter.py            # все главы
         python tools/check_chapter.py chapter_02 # одна глава

Что проверяется:
  - JSON читается;
  - все кадры (props, foreground, pickups, gates, npc, enemies, intro,
    задачи `count`) есть в atlas.json;
  - `answer` в каждой задаче попадает в диапазон `options`, а для
    примеров (`a`, `b`, `op`) и пересчёта (`count`) верный вариант
    действительно равен результату;
  - `needs` у ящика ссылаются на существующие пикапы, стоящие левее ящика;
  - пикапы, НПС, враги, ящики лежат внутри `levelWidth`;
  - пикапы не ближе 120 к ящику; участок врага не пересекает ящики и НПС;
  - в `finale.tasks` значения `a`, `b` есть среди `pickups.value`;
  - мета-поля карточки главы (`number`, `title`, `subtitle`, `summary`,
    `icon`, `cost`, `skills`, `rewards`) на месте.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "server" / "content"
ATLAS = ROOT / "web" / "assets" / "atlas" / "atlas.json"

META_FIELDS = ("number", "title", "subtitle", "summary", "icon", "cost", "skills", "rewards")
LEVELS = ("low", "mid", "high")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def text_ok(value) -> bool:
    """Строка или развилка low/mid/high хотя бы с одним вариантом."""
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return any(isinstance(value.get(k), str) and value[k].strip() for k in LEVELS)
    return False


def right_answer(task: dict):
    if "count" in task:
        return str(task["count"])
    if "a" in task and "b" in task:
        return str(task["a"] - task["b"] if task.get("op") == "-" else task["a"] + task["b"])
    return None


class Checker:
    def __init__(self, frames: set[str]):
        self.frames = frames
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def frame(self, name, where: str) -> None:
        if not isinstance(name, str) or name not in self.frames:
            self.err(f"{where}: кадра «{name}» нет в атласе")

    def task(self, task: dict, where: str, pickup_values: set[int] | None = None) -> None:
        opts = task.get("options")
        if not isinstance(opts, list) or not opts:
            self.err(f"{where}: нет options")
            return
        ans = task.get("answer")
        if not isinstance(ans, int) or not 0 <= ans < len(opts):
            self.err(f"{where}: answer={ans!r} вне диапазона options (0..{len(opts) - 1})")
            return
        kind = "sum" if "a" in task else "count" if "count" in task else "missing" if "missing" in task else None
        if kind is None:
            self.err(f"{where}: задача без a/b, count или missing")
            return
        if kind == "count":
            self.frame(task.get("frame"), f"{where}.frame")
        if kind == "missing":
            if "_" not in str(task["missing"]):
                self.err(f"{where}: в слове «{task['missing']}» нет пропуска «_»")
        expected = right_answer(task)
        if expected is not None and str(opts[ans]) != expected:
            self.err(f"{where}: верный вариант «{opts[ans]}», а по условию должно быть «{expected}»")
        if kind == "sum" and pickup_values is not None:
            for key in ("a", "b"):
                if task[key] not in pickup_values:
                    self.err(f"{where}: {key}={task[key]} нет среди pickups.value {sorted(pickup_values)}")
        if kind == "sum" and task.get("op") == "-" and task["a"] < task["b"]:
            self.err(f"{where}: {task['a']} - {task['b']} меньше нуля")

    def chapter(self, ch: dict, name: str) -> None:
        for key in META_FIELDS:
            if key not in ch:
                self.err(f"нет мета-поля «{key}»")
        if "summary" in ch and not text_ok(ch["summary"]):
            self.err("summary пустой")
        if "icon" in ch:
            self.frame(ch["icon"], "icon")
        if "rewards" in ch:
            for key in ("pickup", "gate", "finale"):
                if not isinstance(ch["rewards"].get(key), int):
                    self.err(f"rewards.{key} должен быть целым числом")
        if ch.get("id") != name:
            self.err(f"id «{ch.get('id')}» не совпадает с именем файла «{name}»")

        width = ch.get("levelWidth", 0)
        if not 6000 <= width <= 7200 and name != "chapter_01":
            self.warn(f"levelWidth={width} вне 6000..7200")
        if not text_ok(ch.get("hint")):
            self.err("hint пустой")
        if not text_ok(ch.get("outro")):
            self.err("outro пустой")

        # вступление
        for i, page in enumerate(ch.get("intro", [])):
            where = f"intro[{i}]"
            t = page.get("type")
            if t in ("text", "scene") and not text_ok(page.get("text")):
                self.err(f"{where}: пустой text")
            if t == "scene":
                self.frame(page.get("frame"), f"{where}.frame")
            if t == "cast":
                for j, c in enumerate(page.get("cast", [])):
                    self.frame(c.get("frame"), f"{where}.cast[{j}]")
                    if not c.get("name"):
                        self.err(f"{where}.cast[{j}]: нет name")
            if t == "learn":
                for j, d in enumerate(page.get("digits", [])):
                    self.frame(d.get("frame"), f"{where}.digits[{j}]")
            if t not in ("text", "cast", "learn", "scene"):
                self.err(f"{where}: неизвестный тип «{t}»")

        # декорации
        for p in ch.get("props", []):
            self.frame(p.get("frame"), f"props.{p.get('id')}")
            if p.get("parallax", 1) == 1 and not -50 <= p.get("x", 0) <= width + 50:
                self.warn(f"props.{p.get('id')}: x={p.get('x')} за краем уровня")
        for i, f in enumerate(ch.get("foreground", [])):
            self.frame(f.get("frame"), f"foreground[{i}]")

        # пикапы
        pickups = ch.get("pickups", [])
        ids: dict[str, dict] = {}
        values: set[int] = set()
        last_x = -1
        for it in pickups:
            where = f"pickups.{it.get('id')}"
            self.frame(it.get("frame"), where)
            if it.get("id") in ids:
                self.err(f"{where}: id повторяется")
            ids[it["id"]] = it
            if not isinstance(it.get("value"), int):
                self.err(f"{where}: value не число")
            else:
                values.add(it["value"])
            x = it.get("x", -1)
            if not 60 <= x <= width - 60:
                self.err(f"{where}: x={x} вне уровня")
            if x <= last_x:
                self.warn(f"{where}: x={x} не возрастает")
            last_x = x
            if it.get("yOffset") != -150 or it.get("scale") != 0.5:
                self.warn(f"{where}: ожидались yOffset=-150, scale=0.5")
        if not 5 <= len(pickups) <= 8:
            self.warn(f"пикапов {len(pickups)}, ожидалось 5..8")

        # ящики
        gates = ch.get("gates", [])
        for g in gates:
            where = f"gates.{g.get('id')}"
            self.frame(g.get("frame"), where)
            gx = g.get("x", -1)
            if not 0 <= gx <= width:
                self.err(f"{where}: x={gx} вне уровня")
            for need in g.get("needs", []):
                if need not in ids:
                    self.err(f"{where}: needs ссылается на несуществующий пикап «{need}»")
                elif ids[need]["x"] >= gx:
                    self.err(f"{where}: пикап «{need}» (x={ids[need]['x']}) стоит не левее ящика (x={gx})")
            for it in pickups:
                if abs(it["x"] - gx) < 120:
                    self.err(f"{where}: пикап «{it['id']}» ближе 120 к ящику")
            if "task" not in g:
                self.err(f"{where}: нет task")
            else:
                self.task(g["task"], f"{where}.task")
        if not 3 <= len(gates) <= 4:
            self.warn(f"ящиков {len(gates)}, ожидалось 3..4")

        # последний пикап должен быть правее последнего ящика, иначе финал
        # откроется раньше, чем ящик понадобится
        if pickups and gates and max(it["x"] for it in pickups) < max(g["x"] for g in gates):
            self.warn("последний ящик стоит правее последнего пикапа: до него не дойти до финала")

        # НПС
        npcs = ch.get("npc", [])
        for n in npcs:
            where = f"npc.{n.get('id')}"
            self.frame(n.get("frame"), where)
            if not 0 <= n.get("x", -1) <= width:
                self.err(f"{where}: x вне уровня")
            d = n.get("dialogue")
            if not d:
                self.err(f"{where}: нет dialogue")
                continue
            if not text_ok(d.get("greeting")):
                self.err(f"{where}: пустой greeting")
            topics = d.get("topics", [])
            if not 2 <= len(topics) <= 4:
                self.warn(f"{where}: тем {len(topics)}, ожидалось 2..4")
            for j, t in enumerate(topics):
                tw = f"{where}.topics[{j}]"
                if not text_ok(t.get("title")) or not text_ok(t.get("text")):
                    self.err(f"{tw}: нет title или text")
                pz = t.get("puzzle")
                if pz:
                    if not text_ok(pz.get("question")):
                        self.err(f"{tw}.puzzle: нет question")
                    opts = pz.get("options", [])
                    ans = pz.get("answer")
                    if not isinstance(ans, int) or not 0 <= ans < len(opts):
                        self.err(f"{tw}.puzzle: answer={ans!r} вне options")
                    for key in ("correct", "wrong"):
                        if not text_ok(pz.get(key)):
                            self.err(f"{tw}.puzzle: нет {key}")
        if not 2 <= len(npcs) <= 3:
            self.warn(f"НПС {len(npcs)}, ожидалось 2..3")

        # враги
        enemies = ch.get("enemies", [])
        for e in enemies:
            where = f"enemies.{e.get('id')}"
            self.frame(e.get("frame"), where)
            if e.get("frameMove"):
                self.frame(e["frameMove"], f"{where}.frameMove")
            lo, hi = e.get("from", 0), e.get("to", 0)
            if not (0 <= lo < hi <= width):
                self.err(f"{where}: участок {lo}..{hi} вне уровня")
            if not lo <= e.get("x", -1) <= hi:
                self.warn(f"{where}: стартовый x={e.get('x')} вне участка {lo}..{hi}")
            # при преследовании Клякса выходит за участок ещё на 220
            reach = (lo - 220, hi + 220)
            for g in gates:
                if lo <= g["x"] <= hi:
                    self.err(f"{where}: участок {lo}..{hi} пересекает ящик {g['id']} x={g['x']}")
                elif reach[0] <= g["x"] <= reach[1]:
                    self.warn(f"{where}: при погоне (+220) Клякса достаёт до ящика {g['id']} x={g['x']}")
            for n in npcs:
                if lo <= n["x"] <= hi:
                    self.err(f"{where}: участок {lo}..{hi} пересекает НПС {n['id']} x={n['x']}")
                elif reach[0] <= n["x"] <= reach[1]:
                    self.warn(f"{where}: при погоне (+220) Клякса достаёт до НПС {n['id']} x={n['x']}")
        if not 1 <= len(enemies) <= 2:
            self.warn(f"врагов {len(enemies)}, ожидалось 1..2")

        # финал
        fin = ch.get("finale")
        if not fin:
            self.err("нет finale")
        else:
            for key in ("count", "title", "hint", "wrong", "done", "after"):
                if not text_ok(fin.get(key)):
                    self.err(f"finale.{key} пустой")
            tasks = fin.get("tasks", [])
            if not 3 <= len(tasks) <= 4:
                self.warn(f"finale.tasks: {len(tasks)} задач, ожидалось 3..4")
            for i, t in enumerate(tasks):
                if "a" not in t:
                    # Finale рисует только примеры (drawSum); count/missing там не покажутся
                    self.err(f"finale.tasks[{i}]: финал умеет только примеры a/b")
                    continue
                self.task(t, f"finale.tasks[{i}]", values)


def main(argv: list[str]) -> int:
    frames = set(load(ATLAS)["frames"].keys())
    names = argv or sorted(p.stem for p in CONTENT.glob("chapter_*.json"))
    failed = 0
    for name in names:
        path = CONTENT / f"{name}.json"
        print(f"== {name}")
        try:
            ch = load(path)
        except (OSError, ValueError) as exc:
            print(f"  ОШИБКА: не читается: {exc}")
            failed += 1
            continue
        c = Checker(frames)
        c.chapter(ch, name)
        for w in c.warnings:
            print(f"  внимание: {w}")
        for e in c.errors:
            print(f"  ОШИБКА: {e}")
        if c.errors:
            failed += 1
        print(f"  {len(ch.get('props', []))} декораций, {len(ch.get('pickups', []))} цифр, "
              f"{len(ch.get('gates', []))} ящиков, {len(ch.get('npc', []))} НПС, "
              f"{len(ch.get('enemies', []))} врагов, {len(ch.get('finale', {}).get('tasks', []))} задач в финале"
              f" - {'ошибок нет' if not c.errors else str(len(c.errors)) + ' ошибок'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
