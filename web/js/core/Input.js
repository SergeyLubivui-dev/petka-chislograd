/**
 * Input - клавиатура и указатель.
 * Управление намеренно простое: стрелки или WASD, пробел, мышь в один клик.
 */
export class Input {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.keys = new Set();
    this.pressed = new Set();     // нажатия за текущий кадр
    this.pointer = { x: 0, y: 0, down: false, clicked: false };

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const move = (e) => {
      const p = this.viewport.toUI(e.clientX, e.clientY);
      this.pointer.x = p.x; this.pointer.y = p.y;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', (e) => { move(e); this.pointer.down = true; });
    canvas.addEventListener('pointerup', (e) => { move(e); this.pointer.down = false; this.pointer.clicked = true; });
  }

  /** Вызывается в конце кадра. */
  endFrame() { this.pressed.clear(); this.pointer.clicked = false; }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  justPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }

  get axisX() {
    let a = 0;
    if (this.down('ArrowLeft', 'KeyA')) a -= 1;
    if (this.down('ArrowRight', 'KeyD')) a += 1;
    return a;
  }

  get jump() { return this.justPressed('Space', 'ArrowUp', 'KeyW'); }
  get confirm() { return this.justPressed('Space', 'Enter', 'NumpadEnter') || this.pointer.clicked; }
}
