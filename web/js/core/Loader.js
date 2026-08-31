/** Загрузка изображений и данных с прогрессом. */
export async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Не загрузилось изображение: ${src}`));
    img.src = src;
  });
}

export async function loadJSON(src) {
  const r = await fetch(src, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Не загрузился файл: ${src} (${r.status})`);
  return r.json();
}

export async function loadAll(tasks, onProgress) {
  const total = tasks.length;
  let done = 0;
  const out = {};
  await Promise.all(tasks.map(async (t) => {
    out[t.key] = t.type === 'json' ? await loadJSON(t.src) : await loadImage(t.src);
    done += 1;
    onProgress?.(done / total);
  }));
  return out;
}
