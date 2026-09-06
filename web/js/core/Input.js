/**
 * Input - клавиатура, мышь и касания.
 *
 * Управление намеренно простое: стрелки или WASD, пробел, мышь в один клик.
 * На планшете и телефоне то же самое делают экранные кнопки (`TouchControls`):
 * сцена каждый кадр отдаёт сюда список зон (`setZones`), а Input сам решает,
 * какое касание попало в зону и какое - в интерфейс.
 *
 * Пальцев может быть несколько одновременно (бежать и прыгать), поэтому все
 * указатели хранятся в `pointers` по `pointerId`. Для интерфейса остаётся один
 * «главный» указатель `pointer` - последний, который не занят экранной кнопкой.
 *
 * Клик (`pointer.clicked`) - это отпускание. Так работает и перетаскивание
 * цифры в трафарет: тянем, отпускаем над трафаретом - и это же «клик» по нему.
 */
export class Input {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.keys = new Set();
    this.pressed = new Set();     // нажатия клавиш за текущий кадр
    this.pointer = { x: -1e4, y: -1e4, down: false, clicked: false, type: 'mouse' };
    this.pointers = new Map();    // pointerId -> { x, y, down, zone, type }
    this.zones = [];              // экранные кнопки: { id, x, y, w, h }
    this.zoneDown = new Set();    // зоны, которые держат сейчас
    this.zonePressed = new Set(); // зоны, нажатые в этом кадре
    this.touched = false;         // хоть раз касались экрана пальцем
    this.parkAfterUp = false;

    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this.zoneDown.clear(); });

    const pos = (e) => this.viewport.toUI(e.clientX, e.clientY);

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touched = true;
      const p = pos(e);
      const zone = this.zoneAt(p);
      const rec = { x: p.x, y: p.y, down: true, zone, control: !!zone, type: e.pointerType };
      this.pointers.set(e.pointerId, rec);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
      if (zone) {
        this.zoneDown.add(zone);
        this.zonePressed.add(zone);
      } else {
        this.pointer.x = p.x; this.pointer.y = p.y;
        this.pointer.down = true;
        this.pointer.type = e.pointerType;
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      const rec = this.pointers.get(e.pointerId);
      if (rec) {
        rec.x = p.x; rec.y = p.y;
        if (rec.control) {
          // палец уехал с кнопки на соседнюю: переключаем, не отпуская
          const z = this.zoneAt(p, rec.zone);
          if (z !== rec.zone) {
            if (rec.zone) this.zoneDown.delete(rec.zone);
            rec.zone = z;
            if (z) { this.zoneDown.add(z); this.zonePressed.add(z); }
          }
          return;
        }
      }
      if (e.pointerType === 'mouse' || rec) {
        this.pointer.x = p.x; this.pointer.y = p.y;
      }
    });

    const up = (e) => {
      const p = pos(e);
      const rec = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (rec?.control) {
        if (rec.zone) this.zoneDown.delete(rec.zone);
        // ту же зону может держать второй палец
        for (const o of this.pointers.values()) if (o.zone && o.zone === rec.zone) this.zoneDown.add(rec.zone);
        return;
      }
      if (!rec) return;
      this.pointer.x = p.x; this.pointer.y = p.y;
      this.pointer.down = false;
      this.pointer.clicked = true;
      // после касания «наведения» не бывает: убираем указатель с экрана,
      // иначе кнопка под последним тапом так и останется подсвеченной
      this.parkAfterUp = e.pointerType !== 'mouse';
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', (e) => {
      if (this.pointers.has(e.pointerId)) up(e);
    });

    // долгое нажатие на планшете вызывает контекстное меню - в игре оно не нужно
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** Зоны экранных кнопок на этот кадр: { id, x, y, w, h }. */
  setZones(zones) { this.zones = zones || []; }

  zoneAt(p, prefer = null) {
    if (prefer) {
      const z = this.zones.find((z) => z.id === prefer);
      if (z && inside(z, p)) return prefer;
    }
    const z = this.zones.find((z) => inside(z, p));
    return z ? z.id : null;
  }

  /** Вызывается в конце кадра логики. */
  endFrame() {
    this.pressed.clear();
    this.zonePressed.clear();
    if (this.pointer.clicked && this.parkAfterUp) {
      this.parkAfterUp = false;
      this.pointer.x = -1e4; this.pointer.y = -1e4;
    }
    this.pointer.clicked = false;
  }

  /** Есть ли на экране палец (а не мышь). */
  get touch() { return this.touched; }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  justPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  zoneHeld(id) { return this.zoneDown.has(id); }
  zoneJustPressed(id) { return this.zonePressed.has(id); }

  get axisX() {
    let a = 0;
    if (this.down('ArrowLeft', 'KeyA') || this.zoneHeld('left')) a -= 1;
    if (this.down('ArrowRight', 'KeyD') || this.zoneHeld('right')) a += 1;
    return a;
  }

  /** Прыжок - только вверх: пробел отдан взаимодействию. */
  get jump() { return this.justPressed('ArrowUp', 'KeyW') || this.zoneJustPressed('jump'); }

  /** Поговорить, подобрать, решить - всё на пробел (и на экранную кнопку «действие»). */
  get interact() {
    return this.justPressed('Space', 'Enter', 'NumpadEnter', 'KeyE') || this.zoneJustPressed('act');
  }

  get confirm() { return this.justPressed('Space', 'Enter', 'NumpadEnter') || this.pointer.clicked; }

  /** Назад / закрыть: Esc или экранная кнопка. */
  get back() { return this.justPressed('Escape') || this.zoneJustPressed('back'); }
}

function inside(z, p) {
  return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
}
