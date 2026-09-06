/**
 * Viewport - адаптация под любой экран: монитор, планшет, телефон.
 *
 * Игра рисуется в виртуальных единицах. Высота сцены фиксирована (DESIGN_H),
 * ширина - плавающая: сколько влезло, столько и видно. Дополнительно
 * гарантируется минимальная видимая ширина (MIN_W), иначе на "квадратных"
 * экранах по краям срезало бы значимую часть сцены.
 *
 * Телефон в альбомной ориентации - экран высотой всего 360-430 CSS-пикселей.
 * Если делить его на 1080, кнопка в 96 единиц станет 35 px - под палец мало.
 * Поэтому на низких экранах виртуальная высота меньше (COMPACT_H): интерфейс
 * получается крупнее, а сцены, знающие про `compact`, ужимают раскладку.
 *
 * Портретную ориентацию игра не поддерживает - рисует поверх просьбу повернуть
 * устройство (DOM-оверлей `#rotate`, см. `style.css`); при переходе в полный
 * экран пробует заблокировать альбомную ориентацию.
 *
 * Чёрных полос нет никогда: канвас всегда занимает всё окно. Вырезы экрана
 * (чёлка iPhone) учитываются через `env(safe-area-inset-*)` - `inset`.
 */
export const DESIGN_H = 1080;
export const COMPACT_H = 860;
export const MIN_W = 1280;
const COMPACT_BELOW = 520;    // CSS-px высоты окна, ниже которой экран «телефонный»

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.scale = 1;
    this.viewW = MIN_W;
    this.viewH = DESIGN_H;
    this.designH = DESIGN_H;
    this.dpr = 1;
    this.compact = false;
    this.portrait = false;
    this.inset = { top: 0, right: 0, bottom: 0, left: 0 };   // в виртуальных единицах
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this._probe = document.getElementById('safe-probe');
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    // iOS меняет размер окна с задержкой после поворота
    window.visualViewport?.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const ch = Math.max(240, this.canvas.clientHeight || window.innerHeight);

    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;

    this.portrait = ch > cw;
    this.compact = Math.min(cw, ch) < COMPACT_BELOW;
    this.designH = this.compact ? COMPACT_H : DESIGN_H;

    this.scale = Math.min(ch / this.designH, cw / MIN_W);
    this.viewW = cw / this.scale;
    this.viewH = ch / this.scale;

    this.readInsets();

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    document.body.classList.toggle('portrait', this.portrait);
  }

  /** Вырезы экрана: CSS отдаёт их в px, переводим в виртуальные единицы. */
  readInsets() {
    const el = this._probe;
    if (!el) return;
    const cs = getComputedStyle(el);
    const px = (v) => (parseFloat(v) || 0) / this.scale;
    this.inset = {
      top: px(cs.paddingTop), right: px(cs.paddingRight),
      bottom: px(cs.paddingBottom), left: px(cs.paddingLeft),
    };
  }

  /** Столько CSS-пикселей в одной виртуальной единице. Нужно, чтобы кнопка под палец не была меньше 60 px. */
  get cssPerUnit() { return this.scale; }

  /** Размер в виртуальных единицах, который на экране будет не меньше `px` CSS-пикселей. */
  atLeastPx(units, px) { return Math.max(units, px / this.scale); }

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

  /** Можно ли уйти в полный экран (на iPhone в Safari - нет). */
  get canFullscreen() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  get isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  /** Полный экран + попытка зафиксировать альбомную ориентацию. Только из жеста. */
  async toggleFullscreen() {
    try {
      if (this.isFullscreen) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
        return;
      }
      const el = document.documentElement;
      await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
      await screen.orientation?.lock?.('landscape').catch(() => {});
    } catch { /* браузер не дал - ничего страшного */ }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    window.visualViewport?.removeEventListener('resize', this._onResize);
  }
}
