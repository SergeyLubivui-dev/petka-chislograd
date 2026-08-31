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

export function drawButton(ctx, btn, { hover = false, seed = 1 } = {}) {
  const lift = hover ? 4 : 0;
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
    ctx.font = `700 ${Math.round(h * 0.42)}px "Comfortaa", "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(btn.label, x + w / 2, y + h / 2 - lift + 2);
    ctx.restore();
  }
}

export function hit(btn, p) {
  return p.x >= btn.x && p.x <= btn.x + btn.w && p.y >= btn.y && p.y <= btn.y + btn.h;
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

/** Рисует изображение «по обложке» - заполняет всю область без искажений. */
export function drawCover(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
