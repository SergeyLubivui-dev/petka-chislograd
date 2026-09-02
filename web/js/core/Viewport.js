/**
 * Viewport - адаптация под любой формат монитора.
 *
 * Игра рисуется в виртуальных единицах. Высота сцены фиксирована (DESIGN_H),
 * ширина - плавающая: сколько влезло, столько и видно. Дополнительно
 * гарантируется минимальная видимая ширина (MIN_W), иначе на "квадратных"
 * мониторах по краям срезало бы значимую часть сцены.
 *
 * Чёрных полос нет никогда: канвас всегда занимает всё окно.
 */
export const DESIGN_H = 1080;
export const MIN_W = 1280;

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scale = 1;
    this.viewW = MIN_W;
    this.viewH = DESIGN_H;
    this.dpr = 1;
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const ch = Math.max(240, this.canvas.clientHeight || window.innerHeight);

    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;

    this.scale = Math.min(ch / DESIGN_H, cw / MIN_W);
    this.viewW = cw / this.scale;
    this.viewH = ch / this.scale;

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  /** Матрица для интерфейса: (0,0) - левый верхний угол видимой области. */
  applyUI() {
    const s = this.scale * this.dpr;
    this.ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  /**
   * Матрица для мира: камера, коэффициент параллакса слоя и приближение.
   *
   * Приближение считается вокруг точки (fx, fy) в единицах интерфейса.
   * По умолчанию это середина экрана по горизонтали и низ по вертикали -
   * тогда при наезде камеры линия пола остаётся на месте, а сцена растёт
   * вверх и в стороны, как в театре.
   *
   *   x' = zoom * (x - cameraX * parallax) + (1 - zoom) * fx
   *   y' = zoom * y + (1 - zoom) * fy
   */
  applyWorld(cameraX, parallax = 1, zoom = 1, fx = this.viewW / 2, fy = this.viewH) {
    const s = this.scale * this.dpr;
    const z = zoom;
    this.ctx.setTransform(
      s * z, 0, 0, s * z,
      s * ((1 - z) * fx - z * cameraX * parallax),
      s * ((1 - z) * fy),
    );
  }

  /** Экранные координаты указателя -> виртуальные координаты интерфейса. */
  toUI(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
  }
}
