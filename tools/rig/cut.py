# -*- coding: utf-8 -*-
"""
Нарезка персонажей на части для перекладной (cut-out) анимации.

Исходники - кадры атласа web/assets/atlas/atlas.png. Каждая часть
задаётся полигоном в координатах кадра плюс операциями «дорисовки»:
там, где часть закрывала соседа (рука поверх рубашки), пробел
заливается клонированием соседних пикселей, чтобы при повороте не было дыр.

Запуск из корня проекта:  python tools/rig/cut.py [превью.png]
Результат:
  web/assets/rig/rig.png                 - один спрайт-лист со всеми частями
  web/assets/rig/rig.json                - скелет: части, пивоты, родители, z
  web/assets/rig/<персонаж>/<часть>.png  - те же части по отдельности
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ATLAS_PNG = os.path.join(ROOT, 'web', 'assets', 'atlas', 'atlas.png')
ATLAS_JSON = os.path.join(ROOT, 'web', 'assets', 'atlas', 'atlas.json')
OUT_DIR = os.path.join(ROOT, 'web', 'assets', 'rig')

FEATHER = 1.1   # мягкость края маски (px)

atlas_img = Image.open(ATLAS_PNG).convert('RGBA')
atlas_map = json.load(open(ATLAS_JSON, encoding='utf-8'))['frames']
_frames = {}


def frame(name):
    """Кадр атласа как numpy-массив RGBA float (кешируется)."""
    if name not in _frames:
        f = atlas_map[name]
        c = atlas_img.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
        _frames[name] = np.array(c).astype(np.float32)
    return _frames[name].copy()


# ----------------------------------------------------------------------
# операции дорисовки (применяются к копии кадра до вырезания маской)
# ----------------------------------------------------------------------

def _tile(band, n, axis):
    """Замостить полосу n раз, каждую вторую - зеркально, чтобы не было швов."""
    reps = int(np.ceil(n / band.shape[axis])) + 1
    pieces = []
    for i in range(reps):
        pieces.append(band if i % 2 == 0 else (band[::-1] if axis == 0 else band[:, ::-1]))
    t = np.concatenate(pieces, axis=axis)
    return t[:n] if axis == 0 else t[:, :n]


def op_fill(img, rect, cols=None, rows=None):
    """Залить прямоугольник полосой колонок (cols) или строк (rows) кадра."""
    x0, y0, x1, y1 = rect
    if cols is not None:
        a, b = cols
        img[y0:y1, x0:x1] = _tile(img[y0:y1, a:b].copy(), x1 - x0, 1)
    if rows is not None:
        a, b = rows
        img[y0:y1, x0:x1] = _tile(img[a:b, x0:x1].copy(), y1 - y0, 0)


def op_fill_poly(img, poly, cols=None, rows=None, shrink=2):
    """Залить область под другой частью (её полигон, чуть суженный), чтобы
    дорисовка не вылезала из-под неё."""
    h, w = img.shape[:2]
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    if shrink > 0:
        m = m.filter(ImageFilter.MinFilter(shrink * 2 + 1))
    mask = (np.array(m).astype(np.float32) / 255.0)[:, :, None]
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    x0, x1 = max(0, min(xs)), min(w, max(xs) + 1)
    y0, y1 = max(0, min(ys)), min(h, max(ys) + 1)
    patch = img[y0:y1, x0:x1].copy()
    if cols is not None:
        patch = _tile(img[y0:y1, cols[0]:cols[1]].copy(), x1 - x0, 1)
    if rows is not None:
        patch = _tile(img[rows[0]:rows[1], x0:x1].copy(), y1 - y0, 0)
    sub = mask[y0:y1, x0:x1]
    img[y0:y1, x0:x1] = patch * sub + img[y0:y1, x0:x1] * (1 - sub)


def op_mirror(img, rect, src_x):
    """Скопировать колонки [src_x, src_x+w) зеркально в rect (например, контур ноги)."""
    x0, y0, x1, y1 = rect
    w = x1 - x0
    img[y0:y1, x0:x1] = img[y0:y1, src_x:src_x + w][:, ::-1]


def op_shift_copy(img, rect, dx, dy):
    """Скопировать rect со сдвигом (dx, dy) - «продлить» шею под голову и т.п."""
    x0, y0, x1, y1 = rect
    patch = img[y0:y1, x0:x1].copy()
    img[y0 + dy:y1 + dy, x0 + dx:x1 + dx] = patch


def op_darken(img, k):
    img[:, :, :3] *= k


def poly_mask(shape, poly, feather=FEATHER):
    h, w = shape[:2]
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in poly], fill=255)
    if feather > 0:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return np.array(m).astype(np.float32) / 255.0


def circle_clip(mask, at, r, side):
    """Скруглить конец части: выше (side='top') / ниже ('bottom') точки
    сустава оставить только круг радиуса r - тогда при сгибе нет ни дыр,
    ни торчащих углов (шарнир как у бумажной куклы)."""
    h, w = mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - at[0]) ** 2 + (yy - at[1]) ** 2)
    soft = np.clip((r + 1.0 - d), 0, 1)
    zone = (yy < at[1]) if side == 'top' else (yy > at[1])
    mask[zone] *= soft[zone]
    return mask


def make_lid(src, ellipse, texture, color=None, line=(60, 40, 30, 255)):
    """Веко для моргания: диск, залитый текстурой кожи/шерсти с соседнего
    участка, снизу тонкая тёмная дуга (закрытый глаз)."""
    img = frame(src)
    cx, cy, rx, ry = ellipse
    w, h = int(rx * 2 + 4), int(ry * 2 + 4)
    out = np.zeros((h, w, 4), np.float32)
    tx0, ty0, tx1, ty1 = texture
    band = img[ty0:ty1, tx0:tx1]
    tile = _tile(_tile(band, h, 0), w, 1)
    out[:, :, :] = tile
    if color is not None:
        out[:, :, :3] = out[:, :, :3] * 0.4 + np.array(color, np.float32) * 0.6
    out[:, :, 3] = 255
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).ellipse([2, 2, w - 3, h - 3], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(0.8))
    mask = np.array(m).astype(np.float32) / 255.0
    ln = Image.new('L', (w, h), 0)
    ImageDraw.Draw(ln).arc([3, 3, w - 4, h - 4], 20, 160, fill=255, width=max(2, int(rx * 0.14)))
    ln = np.array(ln.filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) / 255.0
    col = np.array(line[:3], np.float32)
    out[:, :, :3] = out[:, :, :3] * (1 - ln[:, :, None]) + col * ln[:, :, None]
    out[:, :, 3] *= mask
    return out, (cx - rx - 2, cy - ry - 2)


def cut_part(spec, polys=None):
    """Вырезать одну часть. Возвращает (RGBA float массив, (x0, y0) в кадре).
    polys - полигоны остальных частей персонажа (для 'fillpoly')."""
    if spec.get('kind') == 'lid':
        return make_lid(spec['src'], spec['ellipse'], spec['texture'],
                        spec.get('color'), spec.get('line', (60, 40, 30, 255)))
    img = frame(spec['src'])
    orig_alpha = img[:, :, 3].copy()
    for op in spec.get('ops', []):
        t = op[0]
        if t == 'fill':
            op_fill(img, op[1], cols=op[2], rows=op[3] if len(op) > 3 else None)
        elif t == 'fillpoly':
            poly = polys[op[1]] if isinstance(op[1], str) else op[1]
            op_fill_poly(img, poly, cols=op[2], rows=op[3] if len(op) > 3 else None)
        elif t == 'mirror':
            op_mirror(img, op[1], op[2])
        elif t == 'shift':
            op_shift_copy(img, op[1], op[2], op[3])
        elif t == 'darken':
            op_darken(img, op[1])
    # дорисовка не должна рождать пиксели там, где кадр был прозрачным
    img[:, :, 3] = np.minimum(img[:, :, 3], orig_alpha)
    mask = poly_mask(img.shape, spec['poly'], spec.get('feather', FEATHER))
    for op in spec.get('ops', []):
        if op[0] == 'round':
            circle_clip(mask, op[1], op[2], op[3])
    img[:, :, 3] *= mask
    ys, xs = np.where(img[:, :, 3] > 2)
    if len(xs) == 0:
        raise ValueError(f"пустая часть {spec['name']}")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return img[y0:y1, x0:x1], (int(x0), int(y0))


def to_pil(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# ----------------------------------------------------------------------
# описание персонажей
# ----------------------------------------------------------------------
# Часть: name, src (кадр), poly (полигон в px кадра), pivot (px кадра - ось
# вращения), parent, z (порядок отрисовки, больше - ближе к зрителю), ops,
# axis ('y' - длина вниз от пивота, 'x-' - влево, 'x' - вправо; вдоль оси
# часть можно гнуть), offset (сдвиг клона в кадре), darken.
# 'clone': взять картинку у другой части (дальние руки и ноги).
#
# unit - во сколько раз пиксель части мельче «игрового» пикселя старого кадра:
# крупные портреты *_big нарисованы в 1,8 раза больше игровых кадров, поэтому
# марионетка при том же scale даёт тот же рост, что и старый кадр.

CHARACTERS = {}

# ---------------- Петька ----------------
P = 'petka_stand'
CHARACTERS['petka'] = dict(
    source=P, unit=1.0, origin=(89, 341),
    parts=[
        # дальняя нога - клон ближней, темнее, чуть сзади
        dict(name='shin_far', clone='shin_near', pivot=(80, 296), parent='thigh_far', z=0, offset=(5, 0), darken=0.80),
        dict(name='thigh_far', clone='thigh_near', pivot=(82, 226), parent='torso', z=1, offset=(5, 0), darken=0.80),
        # дальняя рука
        dict(name='forearm_far', clone='forearm_near', pivot=(81, 213), parent='upperarm_far', z=2, offset=(-12, 0), darken=0.80),
        dict(name='upperarm_far', clone='upperarm_near', pivot=(82, 140), parent='torso', z=3, offset=(-12, 0), darken=0.80),
        # ближняя нога: голень (носок + ботинок), поверх неё бедро (шорты)
        dict(name='shin_near', src=P, parent='thigh_near', z=4, pivot=(80, 296), axis='y',
             poly=[(52, 270), (94, 270), (94, 316), (108, 314), (124, 322), (126, 334), (118, 341), (54, 341), (50, 320)],
             ops=[('mirror', (90, 278, 96, 318), 54), ('round', (80, 296), 24, 'top')]),
        dict(name='thigh_near', src=P, parent='torso', z=5, pivot=(82, 226), axis='y',
             poly=[(44, 212), (118, 212), (120, 300), (112, 300), (110, 318), (52, 318), (46, 300)],
             ops=[('fill', (44, 212, 120, 226), None, (228, 240)),
                  ('fill', (62, 236, 100, 262), (46, 60)),
                  ('round', (80, 296), 24, 'bottom')]),
        # рюкзак - за спиной, под рубашкой
        dict(name='backpack', src=P, parent='torso', z=6, pivot=(36, 134), axis='y',
             poly=[(0, 126), (64, 126), (70, 132), (70, 230), (0, 230)],
             ops=[('fill', (56, 138, 70, 230), (38, 55))]),
        # туловище: рубашка; под рукой и рукавом - дорисованная ткань,
        # вверх - продление шеи (прячется под головой)
        dict(name='torso', src=P, parent=None, z=7, pivot=(88, 232), axis='y',
             poly=[(56, 130), (72, 128), (86, 130), (95, 133), (101, 137), (110, 137), (118, 139), (124, 143),
                   (128, 150), (128, 178), (126, 236), (58, 238), (54, 200)],
             ops=[('shift', (100, 128, 124, 140), 0, -14), ('shift', (100, 128, 124, 140), 0, -7),
                  ('fill', (60, 136, 101, 236), (103, 123))]),
        dict(name='head', src=P, parent='torso', z=8, pivot=(112, 128), axis='y',
             poly=[(0, 0), (178, 0), (178, 118), (140, 122), (130, 130), (124, 136), (110, 138), (100, 136), (94, 132),
                   (84, 128), (70, 127), (56, 128), (40, 122), (0, 118)]),
        dict(name='lid', kind='lid', src=P, parent='head', z=8.5, pivot=(129, 54), ellipse=(129, 62, 7, 8), texture=(104, 88, 118, 102)),
        # ближняя рука: рукав с лямкой + плечо до локтя, потом предплечье с кистью
        dict(name='upperarm_near', src=P, parent='torso', z=9, pivot=(82, 140), axis='y',
             poly=[(60, 134), (100, 134), (102, 190), (100, 234), (62, 234), (60, 190)],
             ops=[('round', (81, 213), 20, 'bottom')]),
        dict(name='forearm_near', src=P, parent='upperarm_near', z=10, pivot=(81, 213), axis='y',
             poly=[(60, 192), (102, 192), (102, 250), (96, 264), (66, 266), (60, 250)],
             ops=[('round', (81, 213), 20, 'top')]),
    ])

# ---------------- Кот Тишка ----------------
C = 'cat_big'
CHARACTERS['cat'] = dict(
    source='cat_sit', unit=173 / 313, origin=(157, 313), src_big=C,
    parts=[
        dict(name='body', src=C, parent=None, z=0, pivot=(170, 300), axis='y',
             poly=[(30, 100), (110, 90), (140, 110), (300, 110), (313, 200), (300, 300), (240, 313), (60, 313),
                   (10, 250), (10, 170)],
             ops=[('fillpoly', 'head', None, (205, 240)), ('fillpoly', 'tail', None, (150, 194))]),
        dict(name='tail', src=C, parent='body', z=1, pivot=(150, 278), axis='x-',
             poly=[(152, 250), (154, 300), (128, 310), (60, 309), (18, 292), (2, 250), (6, 218), (30, 196), (70, 194),
                   (108, 222), (138, 244)]),
        dict(name='ear_l', src=C, parent='head', z=2, pivot=(156, 72), axis='y',
             poly=[(128, 92), (128, 40), (140, 12), (162, 18), (186, 60), (188, 92)]),
        dict(name='ear_r', src=C, parent='head', z=3, pivot=(250, 62), axis='y',
             poly=[(220, 70), (226, 30), (248, 2), (262, 6), (280, 44), (292, 70)]),
        dict(name='head', src=C, parent='body', z=4, pivot=(210, 190), axis='y',
             poly=[(98, 108), (108, 80), (128, 60), (150, 48), (180, 46), (225, 44), (250, 50), (272, 62), (292, 74), (300, 100), (313, 100),
                   (313, 130), (296, 150), (292, 178), (262, 200), (200, 206), (160, 196), (120, 172), (96, 140)]),
        dict(name='lid_l', kind='lid', src=C, parent='head', z=5, pivot=(185, 70), ellipse=(185, 92, 24, 24), texture=(165, 42, 205, 62)),
        dict(name='lid_r', kind='lid', src=C, parent='head', z=6, pivot=(248, 58), ellipse=(248, 82, 25, 25), texture=(225, 30, 265, 50)),
    ])

# ---------------- Сова Ольга Петровна ----------------
O = 'owl_read_big'
CHARACTERS['owl'] = dict(
    source='owl_read', unit=190 / 342, origin=(189, 342), src_big=O,
    parts=[
        dict(name='body', src=O, parent=None, z=0, pivot=(170, 330), axis='y',
             poly=[(70, 100), (300, 100), (330, 160), (330, 342), (0, 342), (0, 250), (30, 150)],
             ops=[('fillpoly', 'wing', None, (288, 298))]),
        dict(name='head', src=O, parent='body', z=1, pivot=(180, 140), axis='y',
             poly=[(60, 0), (300, 0), (310, 90), (280, 130), (260, 150), (200, 160), (120, 158), (80, 140), (56, 100)]),
        dict(name='lid_l', kind='lid', src=O, parent='head', z=2, pivot=(150, 62), ellipse=(150, 86, 22, 23), texture=(176, 66, 196, 96), color=(230, 210, 180)),
        dict(name='lid_r', kind='lid', src=O, parent='head', z=3, pivot=(220, 62), ellipse=(220, 86, 22, 23), texture=(176, 66, 196, 96), color=(230, 210, 180)),
        dict(name='wing', src=O, parent='body', z=4, pivot=(60, 168), axis='x',
             poly=[(28, 150), (90, 148), (150, 170), (210, 190), (250, 200), (245, 225), (225, 236), (250, 262), (230, 292),
                   (160, 290), (90, 260), (40, 220), (22, 185)]),
        dict(name='book', src=O, parent='body', z=5, pivot=(300, 296), axis='y',
             poly=[(212, 130), (250, 100), (330, 100), (340, 110), (378, 108), (378, 300), (330, 300), (245, 298), (212, 285)]),
    ])

# ---------------- Пекарь ----------------
B = 'baker_talk_big'
CHARACTERS['baker'] = dict(
    source='baker_a_idle', unit=189 / 340, origin=(118, 340), src_big=B,
    parts=[
        dict(name='arm_far', src=B, parent='body', z=0, pivot=(78, 108), axis='y',
             poly=[(20, 96), (110, 96), (112, 240), (20, 240), (2, 180), (4, 130)]),
        dict(name='body', src=B, parent=None, z=1, pivot=(130, 330), axis='y',
             poly=[(60, 96), (120, 92), (176, 96), (222, 100), (232, 140), (225, 220), (215, 340), (30, 340), (28, 240),
                   (40, 180), (22, 140), (40, 100)],
             ops=[('shift', (125, 114, 178, 126), 0, -12), ('fillpoly', 'upperarm_near', (150, 175))]),
        dict(name='head', src=B, parent='body', z=2, pivot=(140, 110), axis='y',
             poly=[(60, 0), (180, 0), (215, 60), (208, 100), (196, 116), (150, 122), (120, 120), (96, 106), (66, 96), (58, 40)]),
        dict(name='lid', kind='lid', src=B, parent='head', z=3, pivot=(160, 36), ellipse=(160, 46, 9, 10), texture=(120, 70, 150, 90)),
        dict(name='cap', src=B, parent='head', z=4, pivot=(125, 52), axis='y',
             poly=[(64, 0), (170, 0), (178, 30), (172, 60), (140, 66), (100, 60), (68, 50)]),
        dict(name='upperarm_near', src=B, parent='body', z=5, pivot=(188, 108), axis='y',
             poly=[(172, 98), (200, 100), (208, 130), (214, 170), (216, 210), (178, 214)],
             ops=[('round', (214, 196), 13, 'bottom')]),
        dict(name='forearm_near', src=B, parent='upperarm_near', z=6, pivot=(214, 196), axis='y',
             poly=[(204, 212), (208, 175), (214, 150), (222, 125), (240, 106), (262, 103), (287, 120), (287, 150), (258, 172), (236, 212)],
             ops=[('round', (214, 196), 13, 'bottom')]),
    ])

# ---------------- Клякса ----------------
K = 'klyaksa_big'
CHARACTERS['klyaksa'] = dict(
    source='klyaksa_sit', unit=151 / 272, origin=(137, 272), src_big=K,
    parts=[
        dict(name='body', src=K, parent=None, z=0, pivot=(137, 272), axis='y', jelly=True,
             poly=[(0, 0), (274, 0), (274, 272), (0, 272)],
             ops=[('fillpoly', 'drop_a', (105, 135)), ('fillpoly', 'drop_b', (105, 135)), ('fillpoly', 'eye', (110, 150))]),
        dict(name='drop_a', src=K, parent='body', z=1, pivot=(96, 100), axis='x-',
             poly=[(100, 50), (100, 112), (70, 118), (44, 100), (40, 70), (56, 40), (80, 36)]),
        dict(name='drop_b', src=K, parent='body', z=2, pivot=(74, 150), axis='x-',
             poly=[(78, 116), (78, 176), (52, 176), (30, 160), (24, 138), (36, 118), (56, 110)]),
        dict(name='eye', src=K, parent='body', z=3, pivot=(200, 130), axis='y',
             poly=[(162, 50), (200, 46), (238, 60), (246, 92), (236, 122), (204, 134), (170, 124), (158, 96), (156, 70)],
             ops=[('fillpoly', 'pupil', (166, 186))]),
        dict(name='pupil', src=K, parent='eye', z=4, pivot=(214, 92), axis='y',
             poly=[(192, 72), (212, 66), (230, 74), (236, 92), (230, 112), (212, 120), (196, 112), (190, 92)]),
        dict(name='lid', kind='lid', src=K, parent='eye', z=5, pivot=(200, 46), ellipse=(200, 90, 43, 42),
             texture=(110, 40, 160, 100), color=(128, 110, 190), line=(40, 30, 60, 255)),
    ])


# ----------------------------------------------------------------------
# сборка
# ----------------------------------------------------------------------

def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    images = []   # (персонаж, часть, PIL)
    rig = {'image': 'rig.png', 'rigs': {}}

    for cname, ch in CHARACTERS.items():
        parts_out = []
        cut = {}
        polys = {sp['name']: sp['poly'] for sp in ch['parts'] if 'poly' in sp}
        for spec in ch['parts']:
            if 'clone' in spec:
                continue
            arr, (x0, y0) = cut_part(spec, polys)
            cut[spec['name']] = (arr, x0, y0)
        for spec in ch['parts']:
            if 'clone' in spec:
                arr, x0, y0 = cut[spec['clone']]
                arr = arr.copy()
                if spec.get('darken'):
                    op_darken(arr, spec['darken'])
                cut[spec['name']] = (arr, x0, y0)
        for spec in ch['parts']:
            arr, x0, y0 = cut[spec['name']]
            px, py = spec['pivot']
            ox, oy = spec.get('offset', (0, 0))
            pil = to_pil(arr)
            images.append((cname, spec['name'], pil))
            parts_out.append({
                'name': spec['name'],
                'parent': spec['parent'],
                'z': spec['z'],
                'pivot': [px - x0, py - y0],           # в пикселях части
                'world': [px + ox, py + oy],           # положение пивота в кадре (покой)
                'axis': spec.get('axis', 'y'),
                'jelly': bool(spec.get('jelly', False)),
                'w': pil.width, 'h': pil.height,
            })
            os.makedirs(os.path.join(OUT_DIR, cname), exist_ok=True)
            pil.save(os.path.join(OUT_DIR, cname, spec['name'] + '.png'))
        f = atlas_map[ch['source']]
        rig['rigs'][cname] = {
            'source': ch['source'],
            'unit': ch['unit'],
            'height': f['h'],
            'width': f['w'],
            'origin': list(ch['origin']),
            'parts': sorted(parts_out, key=lambda p: p['z']),
        }

    # упаковка в один лист (полочная укладка по убыванию высоты)
    PAD = 2
    order = sorted(range(len(images)), key=lambda i: -images[i][2].height)
    sheet_w = 1024
    x = y = PAD
    row_h = 0
    rects = {}
    for i in order:
        im = images[i][2]
        if x + im.width + PAD > sheet_w:
            x = PAD
            y += row_h + PAD
            row_h = 0
        rects[i] = (x, y)
        x += im.width + PAD
        row_h = max(row_h, im.height)
    sheet_h = y + row_h + PAD
    sheet = Image.new('RGBA', (sheet_w, sheet_h), (0, 0, 0, 0))
    for i, (cname, pname, im) in enumerate(images):
        sx, sy = rects[i]
        sheet.paste(im, (sx, sy))
        for p in rig['rigs'][cname]['parts']:
            if p['name'] == pname:
                p['rect'] = [sx, sy, im.width, im.height]
    sheet.save(os.path.join(OUT_DIR, 'rig.png'), optimize=True)
    with open(os.path.join(OUT_DIR, 'rig.json'), 'w', encoding='utf-8') as fh:
        json.dump(rig, fh, ensure_ascii=False, indent=1)
    print('лист', sheet.size, 'частей', len(images))
    return rig


def preview_rest(rig, out_path):
    """Контроль: собрать части в позе покоя рядом с исходным кадром."""
    sheet = Image.open(os.path.join(OUT_DIR, 'rig.png')).convert('RGBA')
    cols = []
    for cname, ch in rig['rigs'].items():
        src = CHARACTERS[cname].get('src_big', ch['source'])
        f = atlas_map[src]
        w, h = f['w'], f['h']
        canvas = Image.new('RGBA', (w * 2 + 20, h), (255, 250, 240, 255))
        orig = atlas_img.crop((f['x'], f['y'], f['x'] + w, f['y'] + h))
        canvas.alpha_composite(orig, (0, 0))
        for p in ch['parts']:
            x, y, pw, ph = p['rect']
            im = sheet.crop((x, y, x + pw, y + ph))
            wx, wy = p['world']
            px, py = p['pivot']
            canvas.alpha_composite(im, (w + 20 + wx - px, wy - py))
        cols.append(canvas)
    W = max(c.width for c in cols)
    H = sum(c.height for c in cols) + 10 * len(cols)
    out = Image.new('RGBA', (W, H), (255, 250, 240, 255))
    y = 0
    for c in cols:
        out.alpha_composite(c, (0, y))
        y += c.height + 10
    out.save(out_path)


if __name__ == '__main__':
    rig = build()
    if len(sys.argv) > 1:
        preview_rest(rig, sys.argv[1])
        print('превью', sys.argv[1])
