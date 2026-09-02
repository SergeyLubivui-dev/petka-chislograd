/**
 * syllables.js - деление слов на слоги для читателей 6+.
 *
 * Аудитория игры только учится читать, поэтому весь текст можно показать
 * так, как его читают в букваре: «чис-ло-град». Правила взяты школьные,
 * а не фонетические - ребёнку важно удобно прочитать вслух, а не
 * разобрать слово по звучности:
 *
 *   1. слогов столько же, сколько гласных;
 *   2. одна согласная между гласными уходит в следующий слог:  мо-ло-ко;
 *   3. из группы согласных в следующий слог уходит только последняя,
 *      остальные достаются предыдущему слогу:  кош-ка, порт-фель, маль-чик;
 *   4. пара «шумная + р, л, м, н» не разрывается, она уходит вперёд целиком,
 *      иначе получалось бы нечитаемое «чис-лог-рад»:  чис-ло-град, зав-тра;
 *   5. ь, ъ, й не начинают слог и держатся за свою согласную:  зай-ка, ста-тья.
 *
 * Латиница, цифры и знаки препинания не трогаются.
 */

const VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
const SIGNS = 'йьъЙЬЪ';
const SONORANTS = 'рлмнРЛМН';

const isVowel = (ch) => VOWELS.includes(ch);
const isSign = (ch) => SIGNS.includes(ch);
const isSonorant = (ch) => SONORANTS.includes(ch);

/** Делит одно слово на слоги. Слово из одной гласной возвращается как есть. */
export function syllabify(word) {
  const vowels = [];
  for (let i = 0; i < word.length; i++) if (isVowel(word[i])) vowels.push(i);
  if (vowels.length < 2) return [word];

  const parts = [];
  let start = 0;

  for (let k = 0; k < vowels.length - 1; k++) {
    const vi = vowels[k];
    const next = vowels[k + 1];

    // сколько согласных между двумя гласными
    const group = next - vi - 1;

    // сколько из них остаётся в текущем слоге
    let stay = group <= 1 ? 0 : group - 1;
    if (group >= 2) {
      const a = word[next - 2];
      const b = word[next - 1];
      // «шумная + сонорная» читается одним куском: гр, тр, сл, бл, кр...
      if (isSonorant(b) && !isSonorant(a) && !isSign(a)) stay = group - 2;
    }

    let cut = vi + 1 + stay;
    // ь, ъ и й не могут начать слог - отдаём их согласную вперёд
    while (cut > vi + 1 && isSign(word[cut])) cut -= 1;
    if (cut <= vi) cut = vi + 1;

    parts.push(word.slice(start, cut));
    start = cut;
  }
  parts.push(word.slice(start));
  return parts.filter(Boolean);
}

/** Слово с дефисами между слогами: «чис-ло-град». */
export function hyphenate(word, sep = '-') {
  return syllabify(word).join(sep);
}

/** Тот же текст, но каждое русское слово разбито на слоги. */
export function syllabifyText(text, sep = '-') {
  return String(text).replace(/[А-Яа-яЁё]+/g, (w) => hyphenate(w, sep));
}
