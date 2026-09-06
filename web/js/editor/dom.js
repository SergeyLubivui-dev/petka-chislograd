/** dom.js - маленькие помощники для панелей редактора (обычный DOM, без рамок). */

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

/** Строка «подпись - поле». Не label: внутри бывают кнопки и группы полей. */
export const row = (label, ...controls) => el('div', { class: 'row' },
  el('span', { class: 'row-label', text: label }), el('span', { class: 'row-ctl' }, controls));

/**
 * Миниатюра кадра атласа как <img>. Картинка режется из атласа один раз и
 * кладётся в кеш data-URL: кадров под сотню, а панелей с миниатюрами
 * несколько (палитра, выпадающий список кадра), рисовать заново незачем.
 */
const cache = new Map();
export function thumb(atlas, name, size = 54) {
  const key = `${name}@${size}`;
  let url = cache.get(key);
  if (url === undefined) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (atlas.has(name)) {
      const f = atlas.frame(name);
      const s = Math.min((size - 6) / f.w, (size - 6) / f.h);
      const w = f.w * s;
      const h = f.h * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, (size - w) / 2, (size - h) / 2, w, h);
    }
    url = c.toDataURL();
    cache.set(key, url);
  }
  return el('img', { class: 'thumb', src: url, width: size, height: size, alt: name, draggable: 'false' });
}
