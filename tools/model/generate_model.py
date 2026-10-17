"""リアル寄りモルモット GLB 生成（実行: python tools/model/generate_model.py）
- 胴体〜頭〜口元を SDF で融合し、マーチングキューブで 1 枚の連続メッシュにする
- 毛色（写真の三毛）は頂点カラー COLOR_0（リニア）
- ボーン 11 本（鼻ボーン追加）、スキンウェイト付き
単位 m / Y-up / 前方 +Z / 原点は足元中央
"""
import json, struct
from pathlib import Path
import numpy as np
import trimesh
from skimage.measure import marching_cubes

rng = np.random.default_rng(3)

# ------------------------------------------------------------ SDF
def sd_ellipsoid(p, c, r):
    q = (p - np.array(c)) / np.array(r)
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / np.array(r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)

def smax(a, b, k):
    return -smin(-a, -b, k)

def body_sdf(p):
    d = sd_ellipsoid(p, (0, 0.068, -0.012), (0.079, 0.068, 0.090))          # 胴
    d = smin(d, sd_ellipsoid(p, (0, 0.071, -0.058), (0.082, 0.070, 0.064)), 0.03)  # 大きなお尻
    d = smin(d, sd_ellipsoid(p, (0, 0.065, 0.028), (0.068, 0.061, 0.066)), 0.03)   # 胸・肩
    d = smin(d, sd_ellipsoid(p, (0, 0.080, 0.080), (0.054, 0.056, 0.058)), 0.035)  # 頭
    for s in (1, -1):                                                           # ふっくらした頬
        d = smin(d, sd_ellipsoid(p, (s * 0.027, 0.060, 0.103), (0.030, 0.029, 0.034)), 0.02)
    d = smin(d, sd_ellipsoid(p, (0, 0.064, 0.124), (0.026, 0.027, 0.028)), 0.015)  # 口元
    d = smax(d, 0.005 - p[..., 1], 0.012)                                         # お腹は床に平たく
    return d

# ------------------------------------------------------------ メッシュ生成
STEP = 0.0026
lo = np.array([-0.10, -0.01, -0.16]); hi = np.array([0.10, 0.16, 0.18])
axes = [np.arange(lo[i], hi[i] + STEP, STEP) for i in range(3)]
G = np.stack(np.meshgrid(*axes, indexing="ij"), -1)
vol = body_sdf(G)
verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(STEP, STEP, STEP))
verts = verts + lo
body = trimesh.Trimesh(verts, faces[:, ::-1], process=True)   # 外向きの面にする
trimesh.smoothing.filter_taubin(body, lamb=0.5, nu=-0.53, iterations=12)
body = body.simplify_quadric_decimation(face_count=16000)
trimesh.smoothing.filter_taubin(body, lamb=0.5, nu=-0.53, iterations=4)
if body.volume < 0:
    body.invert()

def sdf_normal(p):
    e = 1e-4
    g = np.stack([(body_sdf(p + np.eye(3)[i] * e) - body_sdf(p - np.eye(3)[i] * e)) for i in range(3)], -1)
    return g / np.linalg.norm(g, axis=-1, keepdims=True)

# 表面を探す（レイマーチ）
def surface_hit(origin, direction, t_max=0.3):
    o = np.array(origin, float); dvec = np.array(direction, float); dvec /= np.linalg.norm(dvec)
    t = 0.0
    for _ in range(300):
        d = body_sdf(o + dvec * t)
        if d < 1e-5:
            return o + dvec * t
        t += max(d, 2e-4)
        if t > t_max:
            break
    raise RuntimeError("no hit")

# ------------------------------------------------------------ 小パーツ
def ellipsoid_mesh(radii, center, R=np.eye(3), sub=3):
    m = trimesh.creation.icosphere(subdivisions=sub, radius=1.0)
    n = m.vertices.copy()
    v = n * np.array(radii)
    nn = n / np.array(radii); nn /= np.linalg.norm(nn, axis=1, keepdims=True)
    m.vertices = v @ R.T + np.array(center)
    return m, nn @ R.T

def rot(axis, deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), axis)[:3, :3]

def petal_ear(side):
    """垂れ耳：付け根は頭に沿って立ち、先端側が外へ丸く折り返す"""
    m = trimesh.creation.icosphere(subdivisions=4, radius=1.0)
    u = m.vertices.copy()
    v = u * np.array([0.0190, 0.0160, 0.0019])            # X=前後の幅, Y=高さ, Z=厚み(外向き)
    yy = np.clip(v[:, 1] + 0.004, 0, None)
    v[:, 2] += 18.0 * yy ** 2                               # 上側ほど外へ折れる
    v[:, 1] -= 4.0 * yy ** 2                                # 折れた分だけ下がる
    v[:, 2] -= 5.0 * v[:, 0] ** 2                           # 前後方向に少しカップ状
    base = surface_hit((side * 0.037, 0.2, 0.052), (0, -1, 0))
    R = rot([0, 0, 1], side * -22) @ rot([0, 1, 0], side * 42)
    center = base + np.array([side * 0.002, 0.0105, -0.001])
    m.vertices = v @ R.T + center
    m.fix_normals()
    return m, m.vertex_normals.copy()

# 目：横から当ててめり込ませる
eyes = []
for s in (1, -1):
    hit = surface_hit((s * 0.12, 0.093, 0.102), (-s, 0, 0))
    n = sdf_normal(hit[None])[0]
    c = hit - n * 0.0035
    eyes.append(ellipsoid_mesh((0.0085, 0.0092, 0.0085), c, sub=3))
nose_hit = surface_hit((0, 0.074, 0.25), (0, 0, -1))
nose = ellipsoid_mesh((0.0062, 0.0042, 0.0026), nose_hit + np.array([0, 0.001, -0.0012]), sub=3)
ears = [petal_ear(1), petal_ear(-1)]
feet = {
    "foot_FL": ellipsoid_mesh((0.0075, 0.0048, 0.010), (0.022, 0.0058, 0.078)),
    "foot_FR": ellipsoid_mesh((0.0075, 0.0048, 0.010), (-0.022, 0.0058, 0.078)),
    "foot_BL": ellipsoid_mesh((0.0090, 0.0048, 0.017), (0.045, 0.0060, -0.052), rot([0, 1, 0], 10)),
    "foot_BR": ellipsoid_mesh((0.0090, 0.0048, 0.017), (-0.045, 0.0060, -0.052), rot([0, 1, 0], -10)),
}

# ------------------------------------------------------------ 毛色（写真の三毛）
def srgb2lin(c):
    c = np.asarray(c) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

WHITE, ORANGE, BLACK = srgb2lin([240, 236, 228]), srgb2lin([196, 108, 42]), srgb2lin([28, 24, 24])
K = rng.normal(size=(10, 3)); P = rng.uniform(0, 6.28, 10)
def lf_noise(p, f=55):
    return np.sin((p @ K.T) * f + P).mean(-1) * np.sqrt(2)

def smooth01(x, e0, e1):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def coat(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    n = lf_noise(p)
    zz = z + 0.015 * n + 0.22 * (y - 0.07)
    w = 0.004  # 境界のぼかし幅
    col = np.tile(WHITE, (len(p), 1))
    def paint(mask_soft, c):
        col[:] = col * (1 - mask_soft[:, None]) + c * mask_soft[:, None]
    # 背中のオレンジ（下側は白いお腹に抜ける）
    saddle = smooth01(zz, -0.066, -0.066 + w) * (1 - smooth01(zz, -0.006 - w, -0.006)) \
        * smooth01(y, 0.030 + 0.008 * n, 0.030 + 0.008 * n + w)
    paint(saddle, ORANGE)
    # お尻の黒
    paint(1 - smooth01(zz, -0.092 - w, -0.092 + w), BLACK)
    # 顔：目の周り〜頬はオレンジ、鼻筋と口元は白
    blaze = 0.0075 + np.clip(z - 0.108, 0, None) * 0.9 + 0.0015 * n
    face = smooth01(zz, 0.040, 0.040 + w) * smooth01(np.abs(x), blaze, blaze + 0.0025) \
        * smooth01(y, 0.050 + 0.004 * n, 0.054 + 0.004 * n) * (1 - smooth01(z, 0.128, 0.136))
    paint(face, ORANGE)
    # 左耳側の頭頂の黒ぶち
    cap = smooth01(zz, 0.034, 0.039) * (1 - smooth01(zz, 0.084, 0.090)) \
        * smooth01(y, 0.106 + 0.005 * n, 0.110 + 0.005 * n) * smooth01(x, 0.0 + 0.006 * n, 0.004 + 0.006 * n)
    paint(cap, BLACK)
    return col

SKIN = srgb2lin([214, 150, 138]); EAR = srgb2lin([224, 170, 152]); NOSE = srgb2lin([168, 112, 112])
EYE = np.array([0.004, 0.003, 0.003])

# ------------------------------------------------------------ ボーンとウェイト
nose_c = nose[0].vertices.mean(0)
JOINTS = [
    ("root", -1, (0, 0, 0)),
    ("hips", 0, (0, 0.062, -0.060)),
    ("chest", 1, (0, 0.066, 0.030)),
    ("head", 2, (0, 0.082, 0.068)),
    ("nose", 3, (0, 0.066, 0.116)),
    ("ear.L", 3, tuple(ears[0][0].vertices.mean(0) * [1, 0, 1] + [0, ears[0][0].vertices[:, 1].min() + 0.004, 0])),
    ("ear.R", 3, tuple(ears[1][0].vertices.mean(0) * [1, 0, 1] + [0, ears[1][0].vertices[:, 1].min() + 0.004, 0])),
    ("leg_front.L", 2, (0.025, 0.020, 0.076)),
    ("leg_front.R", 2, (-0.025, 0.020, 0.076)),
    ("leg_back.L", 1, (0.048, 0.020, -0.046)),
    ("leg_back.R", 1, (-0.048, 0.020, -0.046)),
]
JI = {n: i for i, (n, _, _) in enumerate(JOINTS)}
JPOS = np.array([p for _, _, p in JOINTS], float)
LEGS = ["leg_front.L", "leg_front.R", "leg_back.L", "leg_back.R"]
FOOT_C = np.array([feet[k][0].vertices.mean(0) for k in ("foot_FL", "foot_FR", "foot_BL", "foot_BR")])

def pack(wdict, n):
    J = np.zeros((n, 4), np.uint16); W = np.zeros((n, 4), np.float32)
    names = list(wdict); M = np.stack([wdict[k] for k in names], 1)
    order = np.argsort(-M, 1)[:, :4]
    for c in range(order.shape[1]):
        W[:, c] = np.take_along_axis(M, order[:, c:c + 1], 1)[:, 0]
        J[:, c] = np.array([JI[k] for k in names])[order[:, c]]
    J[W <= 1e-4] = 0; W[W <= 1e-4] = 0
    W = (W / W.sum(1, keepdims=True)).astype(np.float32)
    W[:, 0] = 1 - W[:, 1:].sum(1)
    return J, W

def body_weights(p):
    z, y = p[:, 2], p[:, 1]
    wh = smooth01(z, 0.030, 0.072)
    wn = smooth01(z, 0.105, 0.130) * smooth01(y, 0.040, 0.050)
    t = smooth01(z, -0.070, 0.030)
    d = {"hips": (1 - t) * (1 - wh), "chest": t * (1 - wh), "head": wh * (1 - wn), "nose": wh * wn}
    dist = np.linalg.norm(p[:, None] - FOOT_C[None], axis=-1)
    for i, leg in enumerate(LEGS):
        d[leg] = 0.7 * np.exp(-(dist[:, i] / 0.02) ** 2) * (y < 0.035)
    return d

def fixed(n, name):
    return {name: np.ones(n)}

# ------------------------------------------------------------ プリミティブ
def prim(parts):
    P, N, C, J, W, I = [], [], [], [], [], []
    off = 0
    for mesh, normals, color, wd in parts:
        n = len(mesh.vertices)
        P.append(mesh.vertices); N.append(normals)
        C.append(color if color.ndim == 2 else np.tile(color, (n, 1)))
        j, w = pack(wd(mesh.vertices) if callable(wd) else wd, n)
        J.append(j); W.append(w); I.append(mesh.faces + off); off += n
    return [np.concatenate(a) for a in (P, N, C, J, W, I)]

bn = sdf_normal(body.vertices)
fur_prim = prim([(body, bn, coat(body.vertices), body_weights)])
skin_parts = []
for (m, nn), jn in zip(ears, ("ear.L", "ear.R")):
    skin_parts.append((m, nn, EAR, fixed(len(m.vertices), jn)))
skin_parts.append((nose[0], nose[1], NOSE, fixed(len(nose[0].vertices), "nose")))
for k, jn in zip(("foot_FL", "foot_FR", "foot_BL", "foot_BR"), LEGS):
    m, nn = feet[k]; skin_parts.append((m, nn, SKIN, fixed(len(m.vertices), jn)))
skin_prim = prim(skin_parts)
eye_prim = prim([(m, nn, EYE, fixed(len(m.vertices), "head")) for m, nn in eyes])

# ------------------------------------------------------------ GLB
class GLB:
    def __init__(s): s.bin = bytearray(); s.views = []; s.acc = []
    def view(s, data, target=None):
        while len(s.bin) % 4: s.bin.append(0)
        v = {"buffer": 0, "byteOffset": len(s.bin), "byteLength": len(data)}
        if target: v["target"] = target
        s.bin += data; s.views.append(v); return len(s.views) - 1
    def add(s, arr, ct, typ, target=None, mm=False, normalized=False):
        a = np.ascontiguousarray(arr); d = {"bufferView": s.view(a.tobytes(), target), "componentType": ct, "count": len(a), "type": typ}
        if normalized: d["normalized"] = True
        if mm: d["min"] = a.min(0).tolist(); d["max"] = a.max(0).tolist()
        s.acc.append(d); return len(s.acc) - 1

# ダウンロードを小さくするため、精度が要らない属性は整数に詰める（glTF の基本仕様の範囲内）
def unorm16(x):
    return np.round(np.clip(x, 0, 1) * 65535).astype(np.uint16)

def weights16(W):
    # 各頂点の合計がちょうど 65535 になるように丸める（端数は最大の要素に寄せる）
    q = np.round(np.clip(W, 0, 1) / W.sum(1, keepdims=True) * 65535).astype(np.int64)
    q[np.arange(len(q)), q.argmax(1)] += 65535 - q.sum(1)
    return q.astype(np.uint16)

def write(path):
    g = GLB(); meshes = []; nodes = []
    for name, (P, N, C, J, W, I), mat in (("fur_body", fur_prim, 0), ("skin_parts", skin_prim, 1), ("eyes", eye_prim, 2)):
        attrs = {"POSITION": g.add(P.astype(np.float32), 5126, "VEC3", 34962, True),
                 "NORMAL": g.add(N.astype(np.float32), 5126, "VEC3", 34962),
                 # 色は 16bit（VEC4 にして 4 バイト境界にそろえる。A は 1）
                 "COLOR_0": g.add(unorm16(np.hstack([C, np.ones((len(C), 1))])), 5123, "VEC4", 34962, normalized=True),
                 "JOINTS_0": g.add(J.astype(np.uint8), 5121, "VEC4", 34962),
                 "WEIGHTS_0": g.add(weights16(W), 5123, "VEC4", 34962, normalized=True)}
        assert I.max() < 65535
        ind = g.add(I.reshape(-1).astype(np.uint16), 5123, "SCALAR", 34963)
        meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": ind, "material": mat}]})
        nodes.append({"name": name, "mesh": len(meshes) - 1, "skin": 0})
    ibm = []
    for p in JPOS:
        M = np.eye(4); M[:3, 3] = -p; ibm.append(M.flatten(order="F"))
    ibm_acc = g.add(np.array(ibm, np.float32), 5126, "MAT4")
    jn = []
    for name, parent, p in JOINTS:
        local = np.array(p) - (JPOS[parent] if parent >= 0 else 0)
        nodes.append({"name": name, "translation": [float(v) for v in local]}); jn.append(len(nodes) - 1)
    for i, (_, parent, _) in enumerate(JOINTS):
        if parent >= 0: nodes[jn[parent]].setdefault("children", []).append(jn[i])
    gltf = {
        "asset": {"version": "2.0", "generator": "gp_real.py"},
        "scene": 0, "scenes": [{"name": "GuineaPig", "nodes": [0, 1, 2, jn[0]]}],
        "nodes": nodes, "meshes": meshes,
        "skins": [{"name": "guinea_pig_rig", "joints": jn, "inverseBindMatrices": ibm_acc, "skeleton": jn[0]}],
        "materials": [
            {"name": "fur", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.95}},
            {"name": "skin", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.6}},
            {"name": "eye", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.08}},
        ],
        "accessors": g.acc, "bufferViews": g.views, "buffers": [{"byteLength": len(g.bin)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode(); js += b" " * (-len(js) % 4)
    b = bytes(g.bin) + b"\0" * (-len(g.bin) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(b)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(b), 0x004E4942)); f.write(b)

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    out_glb = root / "public" / "models" / "guinea_pig.glb"
    out_lm = root / "src" / "model" / "landmarks.json"
    write(str(out_glb))
    print("wrote", out_glb.relative_to(root))
    print("body verts/faces:", len(body.vertices), len(body.faces), "watertight:", body.is_watertight)
    json.dump({"eye": eyes[0][0].vertices.mean(0).round(4).tolist(), "nose": nose_c.round(4).tolist()},
              open(out_lm, "w"))
    print("wrote", out_lm.relative_to(root))
    print("joints:", [(n, np.round(p, 3).tolist()) for n, _, p in JOINTS])
