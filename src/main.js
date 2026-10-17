// モルモット 3D デモ（Babylon.js）
// 構成：シーン → モデル読み込み → シェルファー → 手続き的アニメーション（待機/歩行/鳴き声）→ UI
// 詳しくは CLAUDE.md を参照。
import "./style.css";
// Babylon は使う分だけ個別に読み込む（パッケージ丸ごとだとバンドルが数 MB 増える）
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { SkeletonViewer } from "@babylonjs/core/Debug/skeletonViewer";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import "@babylonjs/core/Culling/ray";             // scene.createPickingRay
import "@babylonjs/loaders/glTF/glTFFileLoader";   // GLB ローダー（拡張機能は使わないので読み込まない）
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import { CustomMaterial } from "@babylonjs/materials/custom/customMaterial";
import { GPVoice } from "./voice.js";
import landmarks from "./model/landmarks.json";   // tools/model/generate_model.py が書き出す（目・鼻の位置）

const BABYLON = {
  Engine, Scene, ImageProcessingConfiguration, ArcRotateCamera, Camera, HemisphericLight, DirectionalLight,
  ShadowGenerator, StandardMaterial, DynamicTexture, VertexBuffer, SceneLoader, PointerEventTypes,
  Vector3, Matrix, Quaternion, Color3, Color4, Axis, Scalar,
  MeshBuilder: { CreateGround, CreatePlane },
  Debug: { SkeletonViewer },
};

// コンソールや検証スクリプト（tools/check）から触れるように公開（上で読み込んだものだけ）
window.BABYLON = BABYLON;
window.GPVoice = GPVoice;

const glsl3 = (v) => v.map((x) => x.toFixed(4)).join(", ");

(async () => {
  const statusEl = document.getElementById("status");
  const fail = (msg) => { statusEl.hidden = false; statusEl.textContent = msg; };

  const canvas = document.getElementById("view");
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.05;
  ip.contrast = 1.1;

  // カメラ
  const cam = new BABYLON.ArcRotateCamera("cam", Math.PI * 0.72, 1.18, 0.5, new BABYLON.Vector3(0, 0.07, 0.01), scene);
  cam.minZ = 0.005; cam.lowerRadiusLimit = 0.2; cam.upperRadiusLimit = 1.2;
  cam.lowerBetaLimit = 0.25; cam.upperBetaLimit = 1.52;
  cam.wheelDeltaPercentage = 0.01; cam.pinchDeltaPercentage = 0.004;
  cam.panningSensibility = 0;
  cam.attachControl(canvas, true);
  const fitFov = () => {
    if (engine.getAspectRatio(cam) < 1) { cam.fovMode = BABYLON.Camera.FOVMODE_HORIZONTAL_FIXED; cam.fov = 0.62; }
    else { cam.fovMode = BABYLON.Camera.FOVMODE_VERTICAL_FIXED; cam.fov = 0.8; }
  };
  fitFov();

  // ライト
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.62; hemi.diffuse = new BABYLON.Color3(1.0, 0.97, 0.92); hemi.groundColor = new BABYLON.Color3(0.42, 0.38, 0.33);
  hemi.specular = BABYLON.Color3.Black();
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.45, -1, -0.35), scene);
  sun.position = new BABYLON.Vector3(0.4, 0.9, 0.35); sun.intensity = 1.15; sun.diffuse = new BABYLON.Color3(1, 0.95, 0.88);
  const rim = new BABYLON.DirectionalLight("rim", new BABYLON.Vector3(0.5, -0.3, 0.8), scene);
  rim.intensity = 0.45; rim.diffuse = new BABYLON.Color3(0.85, 0.9, 1.0); rim.specular = BABYLON.Color3.Black();

  // 床と接地影
  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 2.2, height: 2.2 }, scene);
  const fadeTex = new BABYLON.DynamicTexture("groundFade", { width: 256, height: 256 }, scene, true);
  { const c = fadeTex.getContext(); const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.85)"); g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g; c.fillRect(0, 0, 256, 256); fadeTex.update(); }
  fadeTex.hasAlpha = true;
  const gm = new BABYLON.StandardMaterial("groundMat", scene);
  gm.diffuseColor = BABYLON.Color3.FromHexString("#b3a582"); gm.specularColor = BABYLON.Color3.Black();
  gm.opacityTexture = fadeTex; gm.opacityTexture.getAlphaFromRGB = false;
  ground.material = gm; ground.receiveShadows = true;

  const aoTex = new BABYLON.DynamicTexture("ao", { width: 256, height: 256 }, scene, false);
  { const c = aoTex.getContext(); const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(0.55, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 256, 256); aoTex.update(); }
  aoTex.hasAlpha = true;
  const ao = BABYLON.MeshBuilder.CreatePlane("contactAO", { width: 0.22, height: 0.36 }, scene);
  ao.rotation.x = Math.PI / 2; ao.position.set(0, 0.0006, -0.005);
  const aom = new BABYLON.StandardMaterial("aoMat", scene);
  aom.diffuseTexture = aoTex; aom.useAlphaFromDiffuseTexture = true; aom.disableLighting = true;
  aom.emissiveColor = BABYLON.Color3.Black(); aom.diffuseColor = BABYLON.Color3.Black(); aom.backFaceCulling = false;
  ao.material = aom; ao.isPickable = false;

  // モデル読み込み
  let res;
  try {
    res = await BABYLON.SceneLoader.ImportMeshAsync("", import.meta.env.BASE_URL + "models/", "guinea_pig.glb", scene);
  } catch (e) {
    console.error(e); fail("モデルを読み込めませんでした。ページを再読み込みしてください。"); return;
  }
  const byName = (n) => res.meshes.find((m) => m.name === n || m.name.startsWith(n));
  const body = byName("fur_body"), skin = byName("skin_parts"), eyes = byName("eyes");
  const skeleton = res.skeletons[0];

  // 頂点カラーはリニアで入っているので、StandardMaterial 用にガンマ空間へ
  for (const m of [body, skin]) {
    const c = m.getVerticesData(BABYLON.VertexBuffer.ColorKind);
    if (!c) continue;
    const stride = c.length / m.getTotalVertices();
    for (let i = 0; i < c.length; i++) if (stride === 3 || i % 4 !== 3) c[i] = Math.pow(c[i], 1 / 2.2);
    m.setVerticesData(BABYLON.VertexBuffer.ColorKind, c, false, stride);
  }
  // 頂点カラーは容量の都合で RGBA（A はすべて 1）。半透明扱いにすると描画順が崩れて影も消えるので切る
  for (const m of [body, skin, eyes]) m.hasVertexAlpha = false;

  // ---- シェルファー
  const FUR_DEFS = `
varying vec3 vRest;
float gpHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 gpHash3(vec3 p){ return vec3(gpHash(p), gpHash(p + 19.19), gpHash(p + 47.53)); }
`;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  // 毛の層の数。URL の ?shells=N で上書きできる（重い端末・検証用）
  const shellParam = parseInt(new URLSearchParams(location.search).get("shells"), 10);
  const SHELLS = Number.isFinite(shellParam) ? Math.max(0, Math.min(64, shellParam)) : (coarse ? 18 : 30);
  function furMaterial(h) {
    const m = new CustomMaterial("fur_" + h.toFixed(3), scene);
    m.specularColor = BABYLON.Color3.Black();
    m.diffuseColor = BABYLON.Color3.White();
    m.AddUniform("shellH", "float", h);
    m.Vertex_Definitions("varying vec3 vRest;");
    m.Vertex_Before_PositionUpdated(`
vRest = positionUpdated;
float furLen = mix(0.0080, 0.0028, smoothstep(0.080, 0.132, positionUpdated.z));
furLen *= mix(0.4, 1.0, smoothstep(0.004, 0.026, positionUpdated.y));
vec3 eyeC = vec3(${glsl3(landmarks.eye)});
float eyeD = distance(vec3(abs(positionUpdated.x), positionUpdated.yz), eyeC);
furLen *= mix(0.08, 1.0, smoothstep(0.0095, 0.016, eyeD));
vec3 comb = vec3(0.0, -0.3, -1.0);
comb = comb - dot(comb, normalUpdated) * normalUpdated;
vec3 noseC = vec3(${glsl3(landmarks.nose)});
furLen *= mix(0.1, 1.0, smoothstep(0.007, 0.014, distance(positionUpdated, noseC)));
positionUpdated = positionUpdated + (normalUpdated * shellH * 0.55 + comb * 1.7 * shellH * shellH) * furLen;
`);
    m.Fragment_Definitions(FUR_DEFS);
    m.Fragment_Custom_Diffuse(`
vec3 q = vRest * 1050.0;
vec3 cid = floor(q);
vec3 rnd = gpHash3(cid);
float dd = length(fract(q) - (0.3 + 0.4 * rnd));
float L = 0.62 + 0.38 * rnd.x;
if (shellH > 0.001) { if (shellH > L || dd > mix(0.55, 0.14, shellH / L)) discard; }
float occl = mix(0.55, 1.0, pow(shellH, 0.7)) * mix(0.9, 1.08, rnd.y);
result = vec3(occl);
`);
    m.Fragment_Before_FragColor(`
float furRim = pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), 3.0);
color.rgb += vec3(1.0, 0.96, 0.9) * furRim * 0.10 * shellH;
`);
    return m;
  }
  const baseFur = furMaterial(0);
  const smoothMat = new BABYLON.StandardMaterial("smooth", scene);
  smoothMat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
  body.material = baseFur;

  const shells = [];
  for (let i = 1; i <= SHELLS; i++) {
    const s = body.clone("fur_shell_" + i, body.parent);
    s.skeleton = body.skeleton;
    s.material = furMaterial(i / SHELLS);
    s.isPickable = false;
    s.alwaysSelectAsActiveMesh = true;
    shells.push(s);
  }
  body.alwaysSelectAsActiveMesh = true;

  const skinMat = new BABYLON.StandardMaterial("skin", scene);
  skinMat.specularColor = new BABYLON.Color3(0.12, 0.1, 0.1); skinMat.specularPower = 24;
  skinMat.emissiveColor = new BABYLON.Color3(0.10, 0.06, 0.05);
  skin.material = skinMat;
  const eyeMat = new BABYLON.StandardMaterial("eye", scene);
  eyeMat.diffuseColor = new BABYLON.Color3(0.015, 0.012, 0.012);
  eyeMat.specularColor = new BABYLON.Color3(1, 1, 1); eyeMat.specularPower = 220;
  eyeMat.emissiveColor = new BABYLON.Color3(0.01, 0.008, 0.008);
  eyes.material = eyeMat;
  skin.alwaysSelectAsActiveMesh = true; eyes.alwaysSelectAsActiveMesh = true;

  // 影
  const sg = new BABYLON.ShadowGenerator(2048, sun);
  sg.usePercentageCloserFiltering = true; sg.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
  sg.bias = 0.0005; sg.normalBias = 0.002; sg.darkness = 0.35;
  sg.addShadowCaster(body); sg.addShadowCaster(skin);
  sun.shadowMinZ = 0.1; sun.shadowMaxZ = 2.5;
  // スキンメッシュのバウンディングは休止姿勢（原点付近）のままなので、自動の影範囲だと
  // 歩いて離れたときに影が見切れる。範囲は固定にして、ライトをモルモットに追従させる
  sun.shadowFrustumSize = 0.6;
  const sunOffset = sun.direction.normalizeToNew().scale(-1.0);
  body.receiveShadows = true;

  // ---- ボーン操作（手続き的アニメーション：待機 / 歩行）
  const nodes = {};
  for (const b of skeleton.bones) {
    const tn = b.getTransformNode();
    if (!tn) continue;
    if (!tn.rotationQuaternion) tn.rotationQuaternion = BABYLON.Quaternion.FromEulerVector(tn.rotation);
    nodes[b.name] = { tn, rest: tn.rotationQuaternion.clone(), restPos: tn.position.clone(), restScale: tn.scaling.clone() };
  }
  const tmpQ = new BABYLON.Quaternion();
  const setRot = (name, x, y, z) => {
    const n = nodes[name]; if (!n) return;
    BABYLON.Quaternion.RotationYawPitchRollToRef(y, x, z, tmpQ);
    n.rest.multiplyToRef(tmpQ, n.tn.rotationQuaternion);
  };
  const setPos = (name, dx, dy, dz) => {
    const n = nodes[name]; if (!n) return;
    n.tn.position.set(n.restPos.x + dx, n.restPos.y + dy, n.restPos.z + dz);
  };
  const setScale = (name, sx, sy, sz) => {
    const n = nodes[name]; if (!n) return;
    n.tn.scaling.set(n.restScale.x * sx, n.restScale.y * sy, n.restScale.z * sz);
  };
  const rad = (d) => d * Math.PI / 180;
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 状態：idle（待機）/ walk（歩行）
  const WALK_SPEED = 0.11;          // m/s
  const STEP_FREQ = 2.6;            // 歩/秒（最大速度時）
  const ROAM_RADIUS = 0.32;         // 歩き回る範囲
  const g = {
    state: "idle", t: 0,
    x: 0, z: 0, heading: 0, speed: 0, turnRate: 0, phase: 0,
    target: null,
    yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, nextLook: 1.5, sniffUntil: 0, nextSniff: 2.5,
    earL: 0, earR: 0, nextEar: 3,
    calls: [], vUp: 0, nextAuto: 6,
  };
  // 鳴く：音を鳴らし、同じイベント列でアニメーションを付ける
  function say(kind) {
    const ev = GPVoice.play(kind);
    for (const e of ev) g.calls.push({ ...e, at: g.t + 0.02 + e.at });
    return ev.length > 0;
  }
  function pickTarget() {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * ROAM_RADIUS;
      const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (Math.hypot(p.x - g.x, p.z - g.z) > 0.14) return p;
    }
    return { x: 0, z: 0 };
  }
  function setState(s) {
    if (s !== "idle" && s !== "walk") return;
    g.state = s;
    if (s === "walk") g.target = pickTarget();
    document.querySelectorAll("[data-state]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.state === s)));
  }

  const aoBaseY = ao.position.y;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
    g.t += dt;
    const amp = reduced ? 0.4 : 1;

    // --- 移動（歩行時のみ目標へ向かう）
    let targetSpeed = 0, desiredTurn = 0;
    if (g.state === "walk" && g.target) {
      const dx = g.target.x - g.x, dz = g.target.z - g.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.03) g.target = pickTarget();
      const want = Math.atan2(dx, dz);                       // glTF の前方 +Z 基準
      const diff = wrapAngle(want - g.heading);
      desiredTurn = BABYLON.Scalar.Clamp(diff * 3.0, -1.8, 1.8);
      targetSpeed = WALK_SPEED * Math.max(0.1, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    }
    g.speed += (targetSpeed - g.speed) * (1 - Math.exp(-dt * 4));
    g.turnRate += (desiredTurn - g.turnRate) * (1 - Math.exp(-dt * 5));
    // その場旋回も足踏みとして扱う
    const w = BABYLON.Scalar.Clamp(Math.max(g.speed / WALK_SPEED, Math.abs(g.turnRate) / 1.8 * 0.7), 0, 1);
    g.heading = wrapAngle(g.heading + g.turnRate * dt);
    g.x += Math.sin(g.heading) * g.speed * dt;
    g.z += Math.cos(g.heading) * g.speed * dt;
    g.phase += dt * Math.PI * 2 * STEP_FREQ * Math.max(w, 0.0001);

    // --- 待機の振る舞い（歩いていないときほど強く出る）
    if (g.t > g.nextLook) {
      g.tYaw = rad((Math.random() * 2 - 1) * 26);
      g.tPitch = rad(-8 + Math.random() * 16);
      g.nextLook = g.t + 1.8 + Math.random() * 3.5;
    }
    const k = 1 - Math.exp(-dt * 3.2);
    g.yaw += (g.tYaw - g.yaw) * k; g.pitch += (g.tPitch - g.pitch) * k;
    if (g.t > g.nextSniff) { g.sniffUntil = g.t + 0.8 + Math.random() * 1.6; g.nextSniff = g.t + 2 + Math.random() * 4; }
    if (g.t > g.nextEar) { if (Math.random() < 0.5) g.earL = 1; else g.earR = 1; g.nextEar = g.t + 2.5 + Math.random() * 5; }
    g.earL *= Math.exp(-dt * 7); g.earR *= Math.exp(-dt * 7);
    const breath = Math.sin(g.t * Math.PI * 2 * (1.25 + 0.6 * w));
    const sniff = g.t < g.sniffUntil ? Math.sin(g.t * Math.PI * 2 * 7.5) : 0;
    const idleW = 1 - w;

    // --- 鳴き声に合わせた動き
    g.calls = g.calls.filter((e) => g.t < e.at + e.dur + 0.4);
    let wheekOn = 0, notePulse = 0, purrOn = 0, chutPulse = 0;
    for (const e of g.calls) {
      const x = (g.t - e.at) / e.dur;
      if (e.k === "wheek") {
        if (g.t > e.at - 0.12 && x < 1.15) wheekOn = 1;
        if (x >= 0 && x <= 1) notePulse = Math.max(notePulse, Math.sin(Math.min(1, x * 2.5) * Math.PI / 2) * (1 - x * 0.4));
      } else if (e.k === "purr") {
        if (x >= 0 && x <= 1) purrOn = Math.max(purrOn, Math.sin(x * Math.PI));
      } else if (e.k === "chut") {
        if (x >= 0 && x <= 1) chutPulse = Math.max(chutPulse, Math.sin(x * Math.PI));
      }
    }
    g.vUp += (wheekOn - g.vUp) * (1 - Math.exp(-dt * (wheekOn ? 14 : 5)));
    const tremor = purrOn * Math.sin(g.t * Math.PI * 2 * 19);

    // --- 自動で鳴く（歩行中はクックッ、待機中はたまにグルグル）
    if (g.t > g.nextAuto) {
      if (g.calls.length === 0) {
        if (w > 0.5) say("chut");
        else if (Math.random() < 0.35) say(Math.random() < 0.7 ? "purr" : "chut");
      }
      g.nextAuto = g.t + (w > 0.5 ? 2.5 + Math.random() * 4 : 9 + Math.random() * 14);
    }

    // --- 歩行サイクル（対角の足が同時に動くトロット風）
    const ph = g.phase;
    const legs = [["leg_front.L", 0], ["leg_back.R", 0], ["leg_front.R", Math.PI], ["leg_back.L", Math.PI]];
    for (const [name, off] of legs) {
      const p = ph + off;
      const swing = Math.max(0, Math.cos(p));
      setPos(name, 0, 0.0055 * swing * w * amp, 0.0085 * Math.sin(p) * w * amp);
      setRot(name, rad(-14) * Math.sin(p) * w * amp, 0, 0);
    }
    const bob = Math.abs(Math.sin(ph)) * 0.0022 * w * amp;
    const sway = Math.sin(ph) * w * amp;

    // --- 体と頭
    setPos("root", g.x, bob, g.z);
    setRot("root", 0, g.heading, 0);
    setScale("chest", 1 + 0.012 * breath * amp + 0.006 * tremor, 1 + 0.018 * breath * amp + 0.025 * g.vUp + 0.008 * tremor, 1);
    setScale("hips", 1 + 0.008 * breath * amp, 1 + 0.010 * breath * amp, 1);
    setRot("hips", rad(1.2) * Math.sin(ph * 2) * w * amp, rad(-2) * sway, rad(2.5) * sway);
    setRot("chest", g.pitch * 0.15 * idleW * (1 - g.vUp) + rad(-5) * g.vUp, g.yaw * 0.25 * idleW + g.turnRate * 0.10 * w + rad(2) * sway, rad(-2.5) * sway);
    const headYaw = g.yaw * 0.75 * idleW + g.turnRate * 0.18 * w;
    const headPitch = g.pitch * 0.85 * idleW + (rad(4) + rad(2.5) * Math.sin(ph * 2)) * w + rad(1.2) * breath * amp * idleW;
    const callPitch = rad(-13) * g.vUp + rad(-4) * notePulse + rad(3) * chutPulse + rad(0.6) * tremor;
    setRot("head", headPitch * (1 - g.vUp * 0.7) + callPitch, headYaw * (1 - g.vUp * 0.6), -headYaw * 0.15);
    setRot("nose", rad(4) * sniff * amp * (idleW * 0.8 + 0.2) * (1 - g.vUp) + rad(-7) * notePulse + rad(-4) * chutPulse, 0, 0);
    setRot("ear.L", rad(3) * Math.sin(ph * 2) * w, 0, rad(-16) * g.earL * amp + rad(4) * sway * w + rad(-9) * g.vUp);
    setRot("ear.R", rad(3) * Math.sin(ph * 2) * w, 0, rad(16) * g.earR * amp + rad(4) * sway * w + rad(9) * g.vUp);

    // --- 接地影とカメラを追従
    const rp = nodes.root.tn.getAbsolutePosition();
    ao.position.set(rp.x, aoBaseY, rp.z);
    const fwd = nodes.root.tn.getDirection(BABYLON.Axis.Z);
    ao.rotation.y = Math.atan2(fwd.x, fwd.z);
    sun.position.set(rp.x + sunOffset.x, sunOffset.y, rp.z + sunOffset.z);
    const ct = cam.target, f = 1 - Math.exp(-dt * 2.5);
    ct.x += (rp.x - ct.x) * f; ct.z += (rp.z - ct.z) * f;
    const sp = BABYLON.Vector3.Project(rp, BABYLON.Matrix.Identity(), scene.getTransformMatrix(),
      cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    GPVoice.setSpatial((sp.x / engine.getRenderWidth() - 0.5) * 1.4, BABYLON.Vector3.Distance(cam.position, rp));
  });

  // ゲーム側から使えるように公開
  window.guineaPig = {
    setState,
    say,                                   // "wheek" | "purr" | "chut"
    sound: GPVoice,                        // setMuted(bool), setVolume(0..1), unlock()
    get state() { return g.state; },
    get time() { return g.t; },          // アニメーション上の経過秒（フレームレートに依らない検証用）
    get calling() { return g.calls.map((e) => e.k)[0] || null; },  // 鳴いている最中の種類
    get position() { return { x: g.x, z: g.z, heading: g.heading }; },
  };

  // ボーン表示
  let viewer = null;
  function showBones(on) {
    if (on && !viewer) {
      viewer = new BABYLON.Debug.SkeletonViewer(skeleton, body, scene, false, 2, {
        displayMode: BABYLON.Debug.SkeletonViewer.DISPLAY_LINES
      });
      viewer.color = BABYLON.Color3.FromHexString("#ff8a2a");
    }
    if (viewer) viewer.isEnabled = on;
  }

  // UI
  const bind = (id, fn) => {
    const b = document.getElementById(id);
    b.addEventListener("click", () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); fn(on); });
  };
  bind("btn-fur", (on) => { shells.forEach((s) => s.setEnabled(on)); body.material = on ? baseFur : smoothMat; });
  document.querySelectorAll("[data-state]").forEach((b) => b.addEventListener("click", () => setState(b.dataset.state)));
  bind("btn-bones", showBones);
  bind("btn-sound", (on) => { GPVoice.unlock(); GPVoice.setMuted(!on); });
  document.getElementById("btn-wheek").addEventListener("click", () => { GPVoice.unlock(); say("wheek"); });
  // ブラウザの自動再生制限のため、最初の操作で音を有効にする
  const firstGesture = () => GPVoice.unlock();
  window.addEventListener("pointerdown", firstGesture, { once: true });
  window.addEventListener("keydown", firstGesture, { once: true });
  // タップでなでる（ボーンで動いた位置に合わせて、体の中心と視線の距離で判定）
  scene.onPointerObservable.add((pi) => {
    const PT = BABYLON.PointerEventTypes;
    if (pi.type !== PT.POINTERTAP && pi.type !== PT.POINTERDOUBLETAP) return;
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), cam);
    const c = nodes.root.tn.getAbsolutePosition().add(new BABYLON.Vector3(0, 0.07, 0));
    const tAlong = BABYLON.Vector3.Dot(c.subtract(ray.origin), ray.direction);
    const closest = ray.origin.add(ray.direction.scale(tAlong));
    if (tAlong > 0 && BABYLON.Vector3.Distance(closest, c) < 0.085) {
      GPVoice.unlock();
      if (g.calls.length === 0) say(Math.random() < 0.8 ? "purr" : "wheek");
    }
  });

  await scene.whenReadyAsync();
  statusEl.hidden = true;
  window.__gpReady = true;
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => { engine.resize(); fitFov(); });
})();
