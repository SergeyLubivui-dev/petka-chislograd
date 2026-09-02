import { syllabifyText } from './syllables.js';

/**
 * text.js - один вход для всего текста игры.
 *
 * Читают дети очень по-разному, поэтому любое поле в JSON может быть либо
 * строкой (одинаковой для всех), либо развилкой по уровню чтения:
 *
 *   "text": "Клякса унесла цифры."
 *   "text": { "low": "Клякса унесла цифры.",
 *             "mid": "Клякса унесла цифры, и город встал.",
 *             "high": "Клякса унесла цифры, и город встал: часы не идут,
 *                      автобус не знает свой номер." }
 *
 * Уровень выбирается в самом начале и лежит в `settings.level`. Если нужного
 * варианта нет, берётся ближайший снизу, потом сверху - текст не исчезает
 * никогда, даже если в главе заполнили только один уровень.
 */

export const LEVELS = ['low', 'mid', 'high'];
export const DEFAULT_LEVEL = 'mid';

/** Выбирает вариант текста под уровень чтения. */
export function pickLevel(value, level = DEFAULT_LEVEL) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);

  const i = Math.max(0, LEVELS.indexOf(level));
  for (let k = i; k >= 0; k--) if (value[LEVELS[k]]) return value[LEVELS[k]];
  for (let k = i + 1; k < LEVELS.length; k++) if (value[LEVELS[k]]) return value[LEVELS[k]];
  return '';
}

/**
 * Текст, готовый к отрисовке: нужный уровень плюс, если включено, слоги.
 * Этим пользуются все сцены - поэтому правило одно на всю игру.
 */
export function readable(value, settings) {
  const s = pickLevel(value, settings?.level);
  return settings?.syllables ? syllabifyText(s) : s;
}
