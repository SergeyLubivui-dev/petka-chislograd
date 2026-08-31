/**
 * SceneManager - конечный автомат сцен с затемнением на переходах.
 * Поток игры: Boot -> Menu -> Story -> Game -> (Outro) -> Menu
 */
export class SceneManager {
  constructor(ctx) {
    this.ctx = ctx;            // общий контекст игры (viewport, input, assets, api)
    this.scenes = new Map();
    this.current = null;
    this.fade = 0;             // 0 - прозрачно, 1 - полностью закрыто
    this.fadeDir = 0;
    this.pendingName = null;
    this.pendingData = null;
  }

  register(name, scene) { this.scenes.set(name, scene); return this; }

  /** Мгновенный переход без затемнения. */
  set(name, data) {
    const scene = this.scenes.get(name);
    if (!scene) throw new Error(`Сцена "${name}" не зарегистрирована`);
    this.current?.exit?.();
    this.current = scene;
    this.currentName = name;
    scene.enter?.(data ?? {});
  }

  /** Переход с затемнением. */
  go(name, data) {
    this.pendingName = name;
    this.pendingData = data;
    this.fadeDir = 1;
  }

  update(dt) {
    if (this.fadeDir === 1) {
      this.fade = Math.min(1, this.fade + dt * 2.6);
      if (this.fade >= 1) {
        this.set(this.pendingName, this.pendingData);
        this.pendingName = null;
        this.fadeDir = -1;
      }
    } else if (this.fadeDir === -1) {
      this.fade = Math.max(0, this.fade - dt * 2.6);
      if (this.fade <= 0) this.fadeDir = 0;
    }
    this.current?.update?.(dt);
  }

  render() {
    this.current?.render?.();
    if (this.fade > 0) {
      const { viewport } = this.ctx;
      viewport.applyUI();
      const c = viewport.ctx;
      c.save();
      c.globalAlpha = this.fade;
      c.fillStyle = '#fdf3df';
      c.fillRect(0, 0, viewport.viewW, viewport.viewH);
      c.restore();
    }
  }
}
