// 動作確認：npm run build のあとに実行（npm run check:smoke）
// - ページが読み込めて、エラーが出ないこと
// - 歩行に切り替えると前進し、待機で止まること
// - 「鳴く」で頭（鼻先）が持ち上がること、本体のタップでグルグルが出ること
// スクリーンショットは .artifacts/ に保存する。
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, OUT, startServer, launch, openPage, sleep, waitGameTime } from "./harness.mjs";

if (!existsSync(path.join(ROOT, "dist/index.html"))) {
  console.error("dist/ がありません。先に npm run build を実行してください。");
  process.exit(1);
}
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); };

const { server, url: base } = await startServer();
// 動きの検証は毛の層を減らして軽くする（見た目のスクリーンショットは通常設定で撮る）
const url = base + "?shells=6";
const browser = await launch();
try {
  const shot = await openPage(browser, base);
  await shot.page.screenshot({ path: path.join(OUT, "desktop-idle.png") });
  check("ページエラーがない（通常設定）", shot.errors.length === 0, shot.errors.slice(0, 3).join(" / "));
  await shot.page.close();

  const { page, errors } = await openPage(browser, url, { width: 640, height: 480 });

  // 歩行：数値で確認（GPU なし環境はフレームレートが低いので長めに待つ）
  const pos = () => page.evaluate(() => guineaPig.position);
  const p0 = await pos();
  await page.evaluate(() => guineaPig.setState("walk"));
  await waitGameTime(page, 3);
  const p1 = await pos();
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check("歩行で前進する", moved > 0.005, `移動 ${(moved * 100).toFixed(1)} cm`);
  await page.screenshot({ path: path.join(OUT, "desktop-walk.png") });
  await page.evaluate(() => guineaPig.setState("idle"));
  await waitGameTime(page, 3);
  const p2 = await pos(); await waitGameTime(page, 1); const p3 = await pos();
  check("待機で止まる", Math.hypot(p3.x - p2.x, p3.z - p2.z) < 0.003);

  // 鳴く：鼻先の高さ
  const noseY = () => page.evaluate(() => BABYLON.Engine.LastCreatedScene.getTransformNodeByName("nose").getAbsolutePosition().y);
  await page.waitForFunction(() => guineaPig.calling === null, { timeout: 300000 });
  await waitGameTime(page, 1);
  const y0 = await noseY();
  await page.click("#btn-wheek");
  await waitGameTime(page, 0.4);
  const y1 = await noseY();
  check("鳴くと頭が上がる", y1 - y0 > 0.005, `鼻先 +${((y1 - y0) * 100).toFixed(1)} cm`);
  await page.screenshot({ path: path.join(OUT, "desktop-wheek.png") });

  // タップでなでる：床では鳴かず、本体で鳴く
  await page.waitForFunction(() => guineaPig.calling === null, { timeout: 300000 });
  await page.mouse.click(30, 300); await sleep(300);
  check("床のタップでは鳴かない", (await page.evaluate(() => guineaPig.calling)) === null);
  const c = await page.evaluate(() => {
    const s = BABYLON.Engine.LastCreatedScene, e = s.getEngine();
    const p = BABYLON.Vector3.Project(s.getTransformNodeByName("root").getAbsolutePosition().add(new BABYLON.Vector3(0, 0.07, 0)),
      BABYLON.Matrix.Identity(), s.getTransformMatrix(), s.activeCamera.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight()));
    const k = e.getRenderWidth() / innerWidth; return { x: p.x / k, y: p.y / k };
  });
  await page.mouse.click(c.x, c.y); await sleep(200);
  check("本体のタップで鳴く", (await page.evaluate(() => guineaPig.calling)) !== null);

  check("ページエラーがない（検証設定）", errors.length === 0, errors.slice(0, 3).join(" / "));

  // スマホ幅
  const m = await openPage(browser, url, { width: 390, height: 844 });
  await m.page.screenshot({ path: path.join(OUT, "mobile.png") });
  check("スマホ幅でエラーがない", m.errors.length === 0);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(`\nスクリーンショット: ${path.relative(process.cwd(), OUT)}/`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
