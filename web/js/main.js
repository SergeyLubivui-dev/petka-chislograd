/**
 * Точка входа. Собирает контекст игры, грузит ресурсы, запускает цикл.
 *
 * Цикл с фиксированным шагом логики (1/60) и свободной отрисовкой:
 * поведение игры не зависит от частоты обновления монитора.
 */
import { Viewport } from './core/Viewport.js';
import { Input } from './core/Input.js';
import { Atlas } from './core/Atlas.js';
import { loadAll } from './core/Loader.js';
import { SceneManager } from './core/SceneManager.js';
import { MenuScene } from './scenes/MenuScene.js';
import { StoryScene } from './scenes/StoryScene.js';
import { GameScene } from './scenes/GameScene.js';

const api = {
  async content(name) {
    const r = await fetch(`/api/content/${name}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Не удалось загрузить главу ${name}`);
    return r.json();
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

async function boot() {
  const canvas = document.getElementById('game');
  const bootEl = document.getElementById('boot');
  const bootText = document.getElementById('boot-text');
  // .t-shimmer клонирует надпись через data-text, поэтому оба значения
  // обновляются вместе, иначе блик поедет по старой строке.
  const setBootText = (t) => { bootText.textContent = t; bootText.dataset.text = t; };

  const viewport = new Viewport(canvas);
  const input = new Input(canvas, viewport);

  const res = await loadAll([
    { key: 'atlasImg', src: 'assets/atlas/atlas.png' },
    { key: 'atlasData', src: 'assets/atlas/atlas.json', type: 'json' },
    { key: 'menuBg', src: 'assets/bg/menu.png' },
    { key: 'farBg', src: 'assets/bg/far.png' },
  ], (p) => setBootText(`Загрузка ${Math.round(p * 100)} %`));

  const game = {
    canvas, viewport, input, api,
    atlas: new Atlas(res.atlasImg, res.atlasData),
    assets: { menuBg: res.menuBg, farBg: res.farBg },
    chapter: null,
    time: 0,
  };

  const scenes = new SceneManager(game);
  game.scenes = scenes;
  scenes.register('menu', new MenuScene(game));
  scenes.register('story', new StoryScene(game));
  scenes.register('game', new GameScene(game));
  scenes.set('menu');

  bootEl.classList.add('hidden');

  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;          // защита от скачка при сворачивании окна
    acc += dt;
    while (acc >= STEP) {
      game.time += STEP;
      scenes.update(STEP);
      input.endFrame();
      acc -= STEP;
    }
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
