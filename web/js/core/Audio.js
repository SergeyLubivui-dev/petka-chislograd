/**
 * Audio - музыка и звуки интерфейса.
 *
 * Музыка - MP3-дорожки в `assets/audio/music/` (CC0, см. `assets/audio/CREDITS.md`),
 * по одной на экран: меню, выбор главы, вступление, глава, задания. Между
 * дорожками - перекрёстное затухание, поэтому переход сцен не «рвёт» звук.
 *
 * Звуки интерфейса (щелчок, монетка, прыжок, верно / не то) не лежат в файлах,
 * а синтезируются Web Audio на лету: два-три осциллятора с огибающей. Так они
 * весят ноль байт, не задерживают загрузку и звучат одинаково везде.
 *
 * Мобильные браузеры не дают играть звук без жеста пользователя, поэтому
 * контекст создаётся и «разблокируется» на первом касании / клике / клавише.
 * До этого вызовы просто запоминают, какая музыка должна звучать.
 *
 * Две отдельные настройки: музыка и звуки. Обе помнятся в localStorage.
 */

const MUSIC_VOLUME = 0.55;
const SFX_VOLUME = 0.9;
const FADE = 0.9;             // перекрёстное затухание между дорожками, с

export class Audio {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.music = readFlag('petka.music', true);
    this.sfx = readFlag('petka.sfx', true);
    this.current = null;        // { name, el, gain }
    this.wanted = null;         // что должно звучать, когда контекст проснётся
    this.tracks = new Map();    // name -> HTMLAudioElement
    this.lastSfx = new Map();   // защита от дребезга одного звука в одном кадре

    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchstart', 'keydown', 'click']) {
      addEventListener(ev, unlock, { passive: true });
    }
    // при сворачивании вкладки музыка тише не станет сама - ставим на паузу
    document.addEventListener('visibilitychange', () => {
      if (!this.current) return;
      if (document.hidden) this.current.el.pause();
      else if (this.music) this.current.el.play().catch(() => {});
    });
  }

  /** Создать контекст и разбудить его: можно только из обработчика жеста. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.music ? MUSIC_VOLUME : 0;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfx ? SFX_VOLUME : 0;
      this.sfxBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this.unlocked) {
      this.unlocked = true;
      // iOS разрешает запуск каждого <audio> только из жеста: «прогреваем» все
      // дорожки прямо сейчас, чтобы смена сцены потом играла без нового касания
      for (const el of this.tracks.values()) this.prime(el);
      if (this.wanted) this.play(this.wanted);
    }
  }

  prime(el) {
    if (el._primed) return;
    el._primed = true;
    const src = this.source(el);
    src.connect(this.musicBus);
    // беззвучно: иначе на миг заиграли бы все восемь дорожек разом
    el.muted = true;
    const done = () => { if (this.current?.el !== el) el.pause(); el.muted = false; };
    const p = el.play();
    if (p?.then) p.then(done).catch(() => { el.muted = false; });
    else done();
  }

  // ---------------------------------------------------------------- музыка

  /** Включить дорожку. Повторный вызов с той же дорожкой ничего не делает. */
  play(name) {
    this.wanted = name;
    if (!this.unlocked || !this.ctx) return;
    if (this.current?.name === name) return;

    const prev = this.current;
    if (prev) this.fadeOut(prev);

    if (!name) { this.current = null; return; }
    const el = this.track(name);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + FADE);
    const src = this.source(el);
    src.disconnect();
    src.connect(gain);
    gain.connect(this.musicBus);
    el.currentTime = 0;
    el.play().catch(() => {});
    this.current = { name, el, gain };
  }

  stop() { this.play(null); }

  fadeOut(entry) {
    const t = this.ctx.currentTime;
    entry.gain.gain.cancelScheduledValues(t);
    entry.gain.gain.setValueAtTime(entry.gain.gain.value, t);
    entry.gain.gain.linearRampToValueAtTime(0, t + FADE);
    setTimeout(() => {
      if (this.current?.el !== entry.el) entry.el.pause();
      try { entry.gain.disconnect(); } catch { /* уже отключён */ }
    }, FADE * 1000 + 50);
  }

  track(name) {
    let el = this.tracks.get(name);
    if (!el) {
      el = new window.Audio(`assets/audio/music/${name}.mp3`);
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      this.tracks.set(name, el);
    }
    return el;
  }

  /** MediaElementSource создаётся один раз на элемент - второй раз браузер не даст. */
  source(el) {
    if (!el._node) el._node = this.ctx.createMediaElementSource(el);
    return el._node;
  }

  /** Заранее подгрузить дорожки, чтобы при переходе не было паузы. */
  preload(names) { for (const n of names) this.track(n); }

  // ---------------------------------------------------------------- настройки

  toggleMusic() {
    this.music = !this.music;
    write('petka.music', this.music);
    if (this.musicBus) this.ramp(this.musicBus, this.music ? MUSIC_VOLUME : 0);
    if (this.music && this.current) this.current.el.play().catch(() => {});
  }

  toggleSfx() {
    this.sfx = !this.sfx;
    write('petka.sfx', this.sfx);
    if (this.sfxBus) this.ramp(this.sfxBus, this.sfx ? SFX_VOLUME : 0);
    if (this.sfx) this.click();
  }

  ramp(node, value) {
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(value, t + 0.25);
  }

  // ---------------------------------------------------------------- звуки

  /**
   * Короткий тон с огибающей. `type` - форма волны, `f0 -> f1` - скольжение
   * частоты, `dur` - длительность, `vol` - громкость, `at` - задержка старта.
   */
  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.12, vol = 0.5, at = 0, attack = 0.005, curve = 'exp' } = {}) {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Шумовой щелчок - для «бумажных» кнопок: как лёгкий хлопок по листу. */
  noise({ dur = 0.05, vol = 0.25, at = 0, hp = 1200 } = {}) {
    if (!this.ctx || !this.sfx) return;
    const t0 = this.ctx.currentTime + at;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t0);
  }

  /** Один и тот же звук не чаще, чем раз в `gap` секунд. */
  guard(name, gap = 0.04) {
    const now = performance.now();
    const last = this.lastSfx.get(name) ?? -1e9;
    if (now - last < gap * 1000) return false;
    this.lastSfx.set(name, now);
    return true;
  }

  /** Нажатие кнопки: короткий «тук» по бумаге и мягкий тон. */
  click() {
    if (!this.guard('click')) return;
    this.noise({ dur: 0.035, vol: 0.18, hp: 1800 });
    this.tone({ type: 'triangle', f0: 620, f1: 480, dur: 0.07, vol: 0.22 });
  }

  /** Лёгкое касание: наведение / выбор варианта. */
  tap() {
    if (!this.guard('tap')) return;
    this.tone({ type: 'triangle', f0: 520, f1: 520, dur: 0.05, vol: 0.14 });
  }

  /** Подобрали цифру: восходящее арпеджио. */
  pickup() {
    if (!this.guard('pickup', 0.1)) return;
    const notes = [523, 659, 784];
    notes.forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.16, vol: 0.28, at: i * 0.07 }));
  }

  /** Монетка: два коротких высоких «дзынь». */
  coin() {
    if (!this.guard('coin', 0.05)) return;
    this.tone({ type: 'square', f0: 1046, dur: 0.07, vol: 0.12 });
    this.tone({ type: 'square', f0: 1568, dur: 0.18, vol: 0.12, at: 0.07 });
  }

  /** Верный ответ: мажорное трезвучие. */
  correct() {
    if (!this.guard('correct', 0.1)) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.22, vol: 0.26, at: i * 0.08 }));
  }

  /** Не то: мягкое «э-э», без резкости - ошибка не наказывается. */
  wrong() {
    if (!this.guard('wrong', 0.1)) return;
    this.tone({ type: 'triangle', f0: 330, f1: 262, dur: 0.22, vol: 0.22, curve: 'lin' });
  }

  jump() {
    if (!this.guard('jump', 0.1)) return;
    this.tone({ type: 'sine', f0: 320, f1: 720, dur: 0.16, vol: 0.2 });
  }

  land() {
    if (!this.guard('land', 0.1)) return;
    this.noise({ dur: 0.05, vol: 0.14, hp: 300 });
    this.tone({ type: 'sine', f0: 180, f1: 120, dur: 0.09, vol: 0.18 });
  }

  /** Клякса задела: «блюп». */
  hurt() {
    if (!this.guard('hurt', 0.2)) return;
    this.tone({ type: 'sawtooth', f0: 240, f1: 110, dur: 0.28, vol: 0.16 });
    this.tone({ type: 'sine', f0: 480, f1: 200, dur: 0.2, vol: 0.12, at: 0.02 });
  }

  /** Страница вступления перелистнулась: шорох бумаги. */
  page() {
    if (!this.guard('page', 0.15)) return;
    this.noise({ dur: 0.12, vol: 0.16, hp: 900 });
  }

  /** Глава пройдена: короткая фанфара. */
  fanfare() {
    if (!this.guard('fanfare', 0.5)) return;
    const seq = [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36], [784, 0.52], [1046, 0.62]];
    seq.forEach(([f, at]) => this.tone({ type: 'triangle', f0: f, dur: 0.3, vol: 0.28, at }));
  }

  /** Ящик уехал: скрип и глухой стук. */
  gate() {
    if (!this.guard('gate', 0.3)) return;
    this.tone({ type: 'sawtooth', f0: 140, f1: 90, dur: 0.35, vol: 0.12 });
    this.noise({ dur: 0.2, vol: 0.12, hp: 400, at: 0.05 });
  }

  /** Новая глава открылась: замок щёлкнул и звёздочки. */
  unlock_() {
    if (!this.guard('unlock', 0.5)) return;
    this.noise({ dur: 0.05, vol: 0.2, hp: 2500 });
    [784, 988, 1175, 1568].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.25, vol: 0.22, at: 0.1 + i * 0.09 }));
  }
}

function write(key, value) {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* приватный режим */ }
}

function readFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}
