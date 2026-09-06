/**
 * Точка входа. Собирает контекст игры, грузит ресурсы, запускает цикл.
 *
 * Цикл с фиксированным шагом логики (1/60) и свободной отрисовкой:
 * поведение игры не зависит от частоты обновления монитора.
 */
import { Viewport } from './core/Viewport.js';
import { Input } from './core/Input.js';
import { Atlas } from './core/Atlas.js';
import { Audio } from './core/Audio.js';
import { Progress } from './core/Progress.js';
import { loadAll, loadImage, loadJSON } from './core/Loader.js';
import { SceneManager } from './core/SceneManager.js';
import { setClickSound } from './core/ui.js';
import { MenuScene } from './scenes/MenuScene.js';
import { ChapterScene } from './scenes/ChapterScene.js';
import { StoryScene } from './scenes/StoryScene.js';
import { GameScene } from './scenes/GameScene.js';
import { PracticeScene } from './scenes/PracticeScene.js';
import { ReaderScene } from './scenes/ReaderScene.js';

const api = {
  async content(name) {
    const r = await fetch(`/api/content/${name}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Не удалось загрузить главу ${name}`);
    return r.json();
  },
  async chapters() {
    try {
      const r = await fetch('/api/chapters', { cache: 'no-cache' });
      if (!r.ok) throw new Error('chapters');
      return await r.json();
    } catch {
      return [{ id: 'chapter_01', number: 1, title: 'Часовая площадь', cost: 0 }];
    }
  },
  async progress() {
    try { return await (await fetch('/api/progress')).json(); } catch { return null; }
  },
  async saveProgress(payload) {
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* офлайн-режим: молча продолжаем */ }
  },
};

/**
 * Настройки чтения: уровень и слоги.
 *
 * Уровень (`low` / `mid` / `high`) спрашивается на первом экране и решает,
 * какой длины тексты показывать - развилки лежат прямо в JSON. Слоги идут
 * следом: тому, кто читает по складам, они нужны, уверенному - мешают.
 * Оба выбора запоминаются в браузере.
 */
const settings = {
  level: readStr('petka.level', null),
  syllables: readFlag('petka.syllables', true),

  get chosen() { return this.level !== null; },

  setLevel(level, syllables) {
    this.level = level;
    write('petka.level', level);
    if (syllables !== undefined) {
      this.syllables = syllables;
      write('petka.syllables', syllables ? '1' : '0');
    }
  },

  toggleSyllables() {
    this.syllables = !this.syllables;
    write('petka.syllables', this.syllables ? '1' : '0');
  },
};

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
}

function readStr(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}

/**
 * Марионетки персонажей (`assets/rig/`) - необязательный ресурс: если папки
 * нет или она не собралась, игра рисует старые кадры из атласа.
 */
async function loadRigs() {
  try {
    const data = await loadJSON('assets/rig/rig.json');
    const names = new Set();
    for (const rig of Object.values(data.rigs ?? data)) {
      const img = rig.image ?? data.image;
      if (img) names.add(img);
      for (const p of rig.parts ?? []) if (p.image) names.add(p.image);
    }
    if (data.image) names.add(data.image);
    const images = {};
    await Promise.all([...names].map(async (n) => { images[n] = await loadImage(`assets/rig/${n}`); }));
    return { data, images };
  } catch (e) {
    console.warn('Марионетки не загружены, рисуем кадры атласа:', e.message);
    return null;
  }
}

async function boot() {
  const canvas = document.getElementById('game');
  const bootEl = document.getElementById('boot');
  const bootText = document.getElementById('boot-text');
  // .t-shimmer клонирует надпись через data-text, поэтому оба значения
  // обновляются вместе, иначе блик поедет по старой строке.
  const setBootText = (t) => { bootText.textContent = t; bootText.dataset.text = t; };

  const viewport = new Viewport(canvas);
  const input = new Input(canvas, viewport);
  const audio = new Audio();
  const progress = new Progress(api);
  setClickSound(() => audio.click());

  const [res, rigs, chapters] = await Promise.all([
    loadAll([
      { key: 'atlasImg', src: 'assets/atlas/atlas.png' },
      { key: 'atlasData', src: 'assets/atlas/atlas.json', type: 'json' },
      { key: 'menuBg', src: 'assets/bg/menu.png' },
      { key: 'farBg', src: 'assets/bg/far.png' },
    ], (p) => setBootText(`Загрузка ${Math.round(p * 100)} %`)),
    loadRigs(),
    api.chapters(),
  ]);
  progress.sync();   // сервер может ответить позже - экран выбора глав перерисует сам

  const game = {
    canvas, viewport, input, api, settings, audio, progress,
    atlas: new Atlas(res.atlasImg, res.atlasData),
    assets: { menuBg: res.menuBg, farBg: res.farBg },
    rigs,
    chapters,            // список глав с сервера: номер, название, цена
    chapter: null,
    time: 0,
  };

  const scenes = new SceneManager(game);
  game.scenes = scenes;
  window.petka = game;   // для отладки в консоли и автотестов
  scenes.register('menu', new MenuScene(game));
  scenes.register('chapters', new ChapterScene(game));
  scenes.register('story', new StoryScene(game));
  scenes.register('game', new GameScene(game));
  scenes.register('practice', new PracticeScene(game));
  scenes.register('reader', new ReaderScene(game));
  // при первом запуске сначала спрашиваем, как ребёнок читает
  scenes.set(settings.chosen ? 'menu' : 'reader');

  audio.preload(['menu', 'chapters', 'story', 'practice', 'game_01', 'game_02', 'game_03', 'game_04']);
  bootEl.classList.add('hidden');

  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();

  /**
   * Логика идёт фиксированным шагом, отрисовка - с частотой монитора,
   * поэтому между кадрами почти всегда остаётся «хвост» времени (`acc`).
   * Если рисовать по последнему шагу логики, на 120-герцевом экране каждый
   * второй кадр повторяет предыдущий, и движение выглядит рваным.
   *
   *   game.alpha   - доля до следующего шага (0..1): сцены смешивают по ней
   *                  прошлое и текущее положение и рисуют промежуточный кадр;
   *   game.frameDt - реальное время кадра: по нему живут чисто визуальные
   *                  вещи (позы марионеток), которым детерминизм не нужен.
   */
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;          // защита от скачка при сворачивании окна
    game.frameDt = dt;
    acc += dt;
    while (acc >= STEP) {
      game.time += STEP;
      scenes.update(STEP);
      input.endFrame();
      acc -= STEP;
    }
    game.alpha = acc / STEP;
    scenes.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  const el = document.getElementById('boot-text') || document.getElementById('boot');
  el.textContent = `Ошибка запуска: ${e.message}`;
  el.dataset.text = el.textContent;
  console.error(e);
});
