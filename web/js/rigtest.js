/**
 * Тестовая страница марионеток: все персонажи в ряд на «полу», рядом для
 * сравнения исходный кадр из атласа в том же масштабе. Кнопки и клавиши
 * переключают состояния; режим «контрольный лист» рисует все фазы ходьбы
 * и прыжка статично (его снимает Playwright в assets/rig/preview.png).
 *
 * Для автоматики наружу торчит window.rigtest: { ready, setState, setNpc,
 * setFlip, sheet(), frame(dt) }.
 */
import { Atlas } from './core/Atlas.js';
import { loadAll } from './core/Loader.js';
import { Puppet, loadRigs } from './core/Puppet.js';

const GRAVITY = 2600;
const JUMP_V = 1080;
const SPEED = 320;

// масштабы как в главе 1
const CHARS = [
  { name: 'petka', scale: 0.63 },
  { name: 'cat', scale: 0.49 },
  { name: 'owl', scale: 0.55 },
  { name: 'baker', scale: 1.59, flip: true },
  { name: 'klyaksa', scale: 0.73 },
];

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

const app = {
  ready: false,
  state: params.get('state') ?? 'idle',
  npc: 'idle',
  flip: false,
  paused: false,
  speed: 1,
  showOrig: true,
  sheetMode: params.get('sheet') === '1',
  zoom: +(params.get('zoom') ?? 1),          // масштаб контрольного листа
  rows: params.get('rows'),                   // какие ряды листа рисовать: '0,1'
  sheetH: 1330,
  time: 0,
  // физика Петьки
  x: 0, y: 0, vy: 0, onGround: true, walkDist: 0, hurt: 0,
  puppets: {},
};

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = app.sheetMode ? 1500 * app.zoom : window.innerWidth;
  const h = app.sheetMode ? app.sheetH : window.innerHeight - document.getElementById('bar').offsetHeight - 30;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  app.dpr = dpr; app.w = w; app.h = h;
}

function setState(s) {
  app.state = s;
  if (s === 'jump' && app.onGround) { app.vy = -JUMP_V; app.onGround = false; }
  if (s === 'hurt') app.hurt = 1.2;
  for (const b of document.querySelectorAll('[data-state]')) b.classList.toggle('on', b.dataset.state === s);
}
function setNpc(s) {
  app.npc = s;
  for (const b of document.querySelectorAll('[data-npc]')) b.classList.toggle('on', b.dataset.npc === s);
}

function update(dt) {
  app.time += dt;
  // Петька: прыжок по vy, ходьба по пройденному пути
  if (!app.onGround) {
    app.vy += GRAVITY * dt;
    app.y += app.vy * dt;
    if (app.y >= 0) { app.y = 0; app.vy = 0; app.onGround = true; if (app.state === 'jump') setState('idle'); }
  }
  if (app.state === 'walk' && app.onGround) app.walkDist += SPEED * dt;
  if (app.hurt > 0) { app.hurt -= dt; if (app.hurt <= 0 && app.state === 'hurt') setState('idle'); }

  for (const c of CHARS) {
    const p = app.puppets[c.name];
    if (!p) continue;
    if (c.name === 'petka') {
      p.update(dt, {
        state: app.onGround ? app.state : 'jump', vx: app.state === 'walk' ? SPEED : 0, vy: app.vy,
        onGround: app.onGround, walkDist: app.walkDist, flip: app.flip, time: app.time, hurt: app.hurt,
      });
    } else if (c.name === 'klyaksa') {
      const vx = app.npc === 'talk' ? 200 * Math.sin(app.time * 0.8) : 0;
      p.update(dt, { state: 'idle', vx, flip: vx < 0, time: app.time, lookX: Math.sin(app.time * 0.9) });
    } else {
      p.update(dt, { state: app.npc, flip: app.flip !== !!c.flip, time: app.time });
    }
  }
}

function drawFloor(groundY, w) {
  ctx.fillStyle = '#f6efe1';
  ctx.fillRect(0, 0, w, canvas.height);
  ctx.strokeStyle = '#c9b48f';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(w, groundY); ctx.stroke();
}

function render() {
  const { atlas } = app;
  ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  const groundY = app.h - 60;
  drawFloor(groundY, app.w);
  let x = 60;
  ctx.font = '14px Comfortaa, sans-serif';
  ctx.fillStyle = '#3b2a1f';
  for (const c of CHARS) {
    const p = app.puppets[c.name];
    if (!p) continue;
    const flip = c.name === 'klyaksa' ? (p.byName.body?.waveTilt < -1) : (app.flip !== !!c.flip);
    const w = Math.max(p.width * c.scale, 120);
    if (app.showOrig && atlas.has(p.source)) {
      atlas.draw(ctx, p.source, x + w / 2, groundY, { scale: c.scale, flipX: flip, alpha: 0.9 });
      ctx.fillText(p.source, x + 10, groundY + 20);
      x += w + 20;
    }
    const y = c.name === 'petka' ? groundY + app.y : groundY;
    // squash & stretch у Петьки при прыжке, как в игре
    let sy = 1, sx = 1;
    if (c.name === 'petka' && !app.onGround) { sy = 1 + Math.max(-0.08, Math.min(0.08, -app.vy * 0.00007)); sx = 1 + (1 - sy) * 0.55; }
    p.draw(ctx, x + w / 2, y, { scale: c.scale, flip, sx, sy });
    ctx.fillText(`${c.name} ×${c.scale}`, x + 10, groundY + 20);
    x += w + 40;
    ctx.fillStyle = '#3b2a1f';
  }
  ctx.fillText(`state: ${app.state}  npc: ${app.npc}  flip: ${app.flip}  walkDist: ${app.walkDist.toFixed(0)}  vy: ${app.vy.toFixed(0)}`, 20, 24);
}

/** Марионетка, прогнанная N кадров с постоянным вводом - установившаяся поза. */
function posed(name, input, frames = 90) {
  const p = new Puppet(app.rigs.data, app.rigs.images, name, { atlas: app.atlas });
  for (let i = 0; i < frames; i++) p.update(1 / 60, { ...input, time: (input.time ?? 0) + i / 60 });
  return p;
}

/** Контрольный лист: фазы ходьбы, прыжка и поз для каждого персонажа. */
function renderSheet() {
  ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  ctx.fillStyle = '#f6efe1';
  ctx.fillRect(0, 0, app.w, app.h);
  ctx.font = '13px Comfortaa, sans-serif';
  const rows = [];
  // Петька: ходьба (8 фаз)
  const walk = [];
  for (let i = 0; i < 8; i++) walk.push({ label: `walk ${i}`, input: { state: 'walk', vx: 320, onGround: true, walkDist: i * 102 / 8 + 600 } });
  rows.push({ name: 'petka', scale: 0.63, poses: walk, title: 'Петька: цикл ходьбы (102 px пути)' });
  rows.push({ name: 'petka', scale: 0.63, title: 'Петька: прыжок и позы', poses: [
    { label: 'stand', input: { state: 'idle', onGround: true, time: 0.4 } },
    { label: 'crouch', input: { state: 'jump', onGround: false, vy: -1080 }, frames: 2 },
    { label: 'up', input: { state: 'jump', onGround: false, vy: -800 }, frames: 40 },
    { label: 'apex', input: { state: 'jump', onGround: false, vy: 0 }, frames: 40 },
    { label: 'down', input: { state: 'jump', onGround: false, vy: 700 }, frames: 40 },
    { label: 'land', input: { state: 'land', onGround: true, vy: 0 }, land: true },
    { label: 'hello', input: { state: 'hello', onGround: true, time: 0.3 } },
    { label: 'hurt', input: { state: 'idle', onGround: true, hurt: 1 } },
    { label: 'walk L', input: { state: 'walk', vx: -320, onGround: true, walkDist: 620, flip: true }, flip: true },
    { label: 'idleFront', input: { state: 'idleFront', onGround: true, time: 0.5 } },
  ] });
  rows.push({ name: 'cat', scale: 0.49, title: 'Кот', poses: [0, 0.9, 1.8, 2.7].map((t) => ({ label: `t=${t}`, input: { state: 'idle', time: t }, frames: 120 })).concat([{ label: 'talk', input: { state: 'talk', time: 1.2 }, frames: 120 }]) });
  rows.push({ name: 'owl', scale: 0.55, title: 'Сова', poses: [0, 1.2, 2.4, 3.3].map((t) => ({ label: `t=${t}`, input: { state: 'idle', time: t }, frames: 120 })).concat([{ label: 'talk', input: { state: 'talk', time: 1.2 }, frames: 120 }]) });
  rows.push({ name: 'baker', scale: 1.59, title: 'Пекарь', flip: true, poses: [0, 0.8, 1.6].map((t) => ({ label: `t=${t}`, input: { state: 'idle', time: t }, frames: 120 })).concat([{ label: 'talk', input: { state: 'talk', time: 1.2 }, frames: 120 }]) });
  rows.push({ name: 'klyaksa', scale: 0.73, title: 'Клякса', poses: [0, 0.3, 0.6, 0.9].map((t) => ({ label: `t=${t}`, input: { state: 'idle', vx: 0, time: t }, frames: 120 })).concat([
    { label: 'move', input: { state: 'idle', vx: 220, time: 0.5 }, frames: 120 },
    { label: 'move L', input: { state: 'idle', vx: -220, flip: true, time: 0.8 }, frames: 120, flip: true },
  ]) });

  let y = 30;
  const rowH = [260, 260, 110, 130, 330, 140];
  const z = app.zoom;
  const wanted = app.rows ? app.rows.split(',').map(Number) : null;
  rows.forEach((row, ri) => {
    if (wanted && !wanted.includes(ri)) return;
    row.scale *= z;
    const h = rowH[ri] * z;
    const ground = y + h - 20;
    ctx.fillStyle = '#3b2a1f';
    ctx.fillText(row.title, 16, y + 4);
    ctx.strokeStyle = '#c9b48f'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(app.w, ground); ctx.stroke();
    let x = 40;
    const src = app.puppets[row.name];
    const cellW = Math.max(src.width * row.scale + 30, 120);
    // исходный кадр
    app.atlas.draw(ctx, src.source, x + cellW / 2, ground, { scale: row.scale, flipX: !!row.flip });
    ctx.fillText('атлас', x + cellW / 2 - 16, ground + 14);
    x += cellW;
    for (const pose of row.poses) {
      let p;
      if (pose.land) {
        // приземление: сначала полёт, потом касание
        p = posed(row.name, { state: 'jump', onGround: false, vy: 600 }, 30);
        for (let i = 0; i < 5; i++) p.update(1 / 60, { state: 'land', onGround: true, vy: 0, time: i / 60 });
      } else p = posed(row.name, pose.input, pose.frames ?? 90);
      const flip = !!row.flip !== !!pose.flip;
      p.draw(ctx, x + cellW / 2, ground, { scale: row.scale, flip });
      ctx.fillText(pose.label, x + cellW / 2 - 16, ground + 14);
      x += cellW;
    }
    y += h;
  });
}

function sheetHeight() {
  const rowH = [260, 260, 110, 130, 330, 140];
  const wanted = app.rows ? app.rows.split(',').map(Number) : rowH.map((_, i) => i);
  return 40 + wanted.reduce((a, i) => a + rowH[i] * app.zoom, 0);
}

function frame(dt) {
  if (app.sheetMode) { renderSheet(); return; }
  if (!app.paused) update(dt * app.speed);
  render();
}

async function boot() {
  const res = await loadAll([
    { key: 'atlasImg', src: 'assets/atlas/atlas.png' },
    { key: 'atlasData', src: 'assets/atlas/atlas.json', type: 'json' },
  ]);
  app.atlas = new Atlas(res.atlasImg, res.atlasData);
  app.rigs = await loadRigs('assets/rig/');
  for (const c of CHARS) app.puppets[c.name] = new Puppet(app.rigs.data, app.rigs.images, c.name, { atlas: app.atlas });
  app.sheetH = sheetHeight();
  resize();
  window.addEventListener('resize', resize);

  for (const b of document.querySelectorAll('[data-state]')) b.onclick = () => setState(b.dataset.state);
  for (const b of document.querySelectorAll('[data-npc]')) b.onclick = () => setNpc(b.dataset.npc);
  document.getElementById('flip').onclick = () => { app.flip = !app.flip; };
  document.getElementById('pause').onclick = () => { app.paused = !app.paused; };
  document.getElementById('sheet').onclick = () => { app.sheetMode = !app.sheetMode; resize(); };
  const speed = document.getElementById('speed');
  speed.oninput = () => { app.speed = +speed.value; document.getElementById('speedv').textContent = app.speed.toFixed(2); };
  document.getElementById('orig').onchange = (e) => { app.showOrig = e.target.checked; };
  window.addEventListener('keydown', (e) => {
    const map = { Digit1: 'idle', Digit2: 'walk', Digit3: 'jump', Digit4: 'hello', Digit5: 'hurt', Digit6: 'idleFront' };
    if (map[e.code]) setState(map[e.code]);
    if (e.code === 'Digit7') setNpc('idle');
    if (e.code === 'Digit8') setNpc('talk');
    if (e.code === 'Space') { setState('jump'); e.preventDefault(); }
    if (e.code === 'KeyF') app.flip = !app.flip;
    if (e.code === 'KeyP') app.paused = !app.paused;
    if (e.code === 'KeyS') { app.sheetMode = !app.sheetMode; resize(); }
  });
  setState(app.state);

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  app.ready = true;
}

/** Сколько миллисекунд занимает отрисовка всех марионеток n раз. */
function bench(n = 300) {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    for (const c of CHARS) app.puppets[c.name]?.draw(ctx, 300, 500, { scale: c.scale });
  }
  return (performance.now() - t0) / n;
}

window.rigtest = {
  app, bench,
  get ready() { return app.ready; },
  setState, setNpc,
  setFlip: (f) => { app.flip = f; },
  setPaused: (p) => { app.paused = p; },
  step: (dt) => { update(dt); render(); },
  sheet: () => { app.sheetMode = true; resize(); renderSheet(); },
};

boot().catch((e) => { console.error(e); document.getElementById('hint').textContent = `Ошибка: ${e.message}`; });
