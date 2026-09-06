/**
 * ui.js - «бумажные» элементы интерфейса, нарисованные процедурно.
 * Кнопка = кусок бумаги с неровным краем: прямоугольник со скруглением,
 * у которого стороны слегка «дрожат». Форма детерминирована (seed),
 * поэтому кнопка не дёргается между кадрами.
 */
export const PALETTE = {
  paper: '#fdf3df',
  paperDark: '#f0e0bd',
  ink: '#5a3f2e',
  green: '#8cbf6a',
  yellow: '#f2c14e',
  blue: '#7fb6d9',
  red: '#d97b62',
  shadow: 'rgba(90,63,46,.22)',
};

function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Путь «рваной бумаги» - прямоугольник с дрожащим контуром. */
export function paperPath(ctx, x, y, w, h, r = 18, seed = 1, jitter = 3) {
  const rand = rnd(seed);
  const j = () => (rand() - 0.5) * 2 * jitter;
  const pts = [];
  const step = 26;
  const edge = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t + j(), y0 + (y1 - y0) * t + j()]);
    }
  };
  edge(x + r, y, x + w - r, y);
  edge(x + w, y + r, x + w, y + h - r);
  edge(x + w - r, y + h, x + r, y + h);
  edge(x, y + h - r, x, y + r);

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    ctx.quadraticCurveTo(px, py, (px + cx) / 2, (py + cy) / 2);
  }
  ctx.closePath();
}

export const FONT = '"Comfortaa", "Segoe UI", system-ui, sans-serif';
export function font(size, weight = 700) { return `${weight} ${Math.round(size)}px ${FONT}`; }

/**
 * Звук нажатия. Кнопки рисуются процедурно и не знают про Audio, поэтому
 * `main.js` подключает щелчок один раз, а сцены зовут `clickSound()` там,
 * где обработали нажатие. Так звук есть у всех кнопок игры без правки каждой.
 */
let clickSound = () => {};
export function setClickSound(fn) { clickSound = fn || (() => {}); }
export function playClick() { clickSound(); }

export function drawButton(ctx, btn, { hover = false, seed = 1, pressed = false } = {}) {
  const lift = pressed ? -2 : (hover ? 4 : 0);
  const { x, y, w, h } = btn;

  ctx.save();
  ctx.fillStyle = PALETTE.shadow;
  paperPath(ctx, x + 5, y + 8 - lift, w, h, 20, seed + 7);
  ctx.fill();

  ctx.fillStyle = btn.color || PALETTE.paper;
  paperPath(ctx, x, y - lift, w, h, 20, seed);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = PALETTE.ink;
  ctx.stroke();
  ctx.restore();

  if (btn.label) {
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // кегль от высоты, но не шире кнопки: на планшете кнопки выше, а подписи те же
    let fs = Math.round(h * 0.42);
    ctx.font = `700 ${fs}px ${FONT}`;
    while (ctx.measureText(btn.label).width > w - 26 && fs > 12) {
      fs -= 1;
      ctx.font = `700 ${fs}px ${FONT}`;
    }
    ctx.fillText(btn.label, x + w / 2, y + h / 2 - lift + 2);
    ctx.restore();
  }
}

export function hit(btn, p) {
  return p.x >= btn.x && p.x <= btn.x + btn.w && p.y >= btn.y && p.y <= btn.y + btn.h;
}

/**
 * Первая кнопка из списка, по которой щёлкнули в этом кадре, или null.
 * Заодно ставит курсор-«руку» над кнопкой и щёлкает звуком при нажатии -
 * общее место для всех сцен, чтобы не повторять три строки в каждой.
 */
export function clickedButton(game, buttons) {
  const { input, canvas } = game;
  const over = buttons.findIndex((b) => !b.disabled && hit(b, input.pointer));
  canvas.classList.toggle('pointer', over >= 0);
  if (input.pointer.clicked && over >= 0) {
    clickSound();
    return buttons[over];
  }
  return null;
}

// ---------------------------------------------------------------- монетка

/** Золотая монетка с цифрой «1» - валюта игры. Рисуется процедурно, без кадра. */
export function drawCoin(ctx, cx, cy, r, { spin = 0 } = {}) {
  // «вращение»: монета сжимается по горизонтали, как повёрнутая
  const sx = Math.max(0.18, Math.abs(Math.cos(spin)));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, 1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f2c14e';
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.strokeStyle = '#8a5a1e';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
  ctx.strokeStyle = '#d99a2b';
  ctx.lineWidth = Math.max(1.5, r * 0.09);
  ctx.stroke();
  ctx.fillStyle = '#8a5a1e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(r * 1.1)}px ${FONT}`;
  ctx.fillText('1', 0, r * 0.06);
  // блик
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.4, r * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fill();
  ctx.restore();
}

/**
 * Кошелёк: бумажная плашка с монеткой и числом. Возвращает занятую ширину.
 * `bump` (0..1) - недавно пришли монеты: плашка чуть подпрыгивает.
 */
export function drawCoinBadge(ctx, x, y, coins, { h = 64, seed = 5, bump = 0, time = 0, align = 'left' } = {}) {
  const r = h * 0.34;
  ctx.font = `800 ${Math.round(h * 0.46)}px ${FONT}`;
  const label = String(coins);
  const w = r * 2 + 30 + ctx.measureText(label).width + 26;
  if (align === 'right') x -= w;
  const lift = bump * 8;
  ctx.save();
  ctx.fillStyle = PALETTE.shadow;
  paperPath(ctx, x + 4, y + 6 - lift, w, h, 18, seed + 3, 2.5);
  ctx.fill();
  ctx.fillStyle = '#fffaf0';
  paperPath(ctx, x, y - lift, w, h, 18, seed, 2.5);
  ctx.fill();
  ctx.lineWidth = 3.5; ctx.strokeStyle = PALETTE.ink; ctx.stroke();
  drawCoin(ctx, x + 14 + r, y + h / 2 - lift, r, { spin: bump > 0 ? time * 9 : 0 });
  ctx.fillStyle = PALETTE.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(h * 0.46)}px ${FONT}`;
  ctx.fillText(label, x + 14 + r * 2 + 16, y + h / 2 + 2 - lift);
  ctx.restore();
  return w;
}

/** Замочек - глава закрыта. */
export function drawLock(ctx, cx, cy, s) {
  ctx.save();
  ctx.strokeStyle = PALETTE.ink;
  ctx.fillStyle = '#c9b48f';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.18, s * 0.28, Math.PI, 0);
  ctx.stroke();
  paperPath(ctx, cx - s * 0.42, cy - s * 0.18, s * 0.84, s * 0.66, s * 0.14, 77, 1.5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.1, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - s * 0.035, cy + s * 0.1, s * 0.07, s * 0.2);
  ctx.restore();
}

/** Звёздочка: заполненная или контурная. */
export function drawStar(ctx, cx, cy, r, filled = true) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = filled ? PALETTE.yellow : '#f3ecd8';
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.strokeStyle = filled ? '#b8862a' : '#cbbb9a';
  ctx.stroke();
  ctx.restore();
}

/** Разбивка текста по ширине - для сцены истории. */
export function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------- трафареты

const ghostCache = new Map();

/**
 * Кадр атласа, приглушённый до цвета бумаги - «трафарет», место для предмета.
 *
 * Заливать силуэт по альфе нельзя: цифры нарисованы с широкой бумажной
 * подложкой, и силуэт получается бесформенным пятном. Поэтому цифра остаётся
 * собой, но выцветает - форму видно, а «ещё не нашёл» читается.
 *
 * Возвращает готовый канвас размером с кадр; результат кешируется.
 */
export function ghostFrame(atlas, frame, tint = 'rgba(243,236,216,.7)') {
  const key = `${frame}|${tint}`;
  const cached = ghostCache.get(key);
  if (cached) return cached;

  const f = atlas.frame(frame);
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const g = c.getContext('2d');
  g.drawImage(atlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  g.globalCompositeOperation = 'source-atop';   // краска ложится только на рисунок
  g.fillStyle = tint;
  g.fillRect(0, 0, f.w, f.h);

  ghostCache.set(key, c);
  if (ghostCache.size > 48) ghostCache.delete(ghostCache.keys().next().value);
  return c;
}

/** Рисует изображение «по обложке» - заполняет всю область без искажений. */
export function drawCover(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
