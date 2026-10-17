// 検証用の共通処理：dist/ をローカルで配信し、ヘッドレス Chrome で開く
import { preview } from "vite";
import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = path.join(ROOT, ".artifacts");
mkdirSync(OUT, { recursive: true });

export async function startServer() {
  const server = await preview({ root: ROOT, preview: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  return { server, url: server.resolvedUrls.local[0] };
}

// GPU のない環境（CI やクラウド）では SwiftShader で WebGL を動かす。
// CHROME_PATH を指定すると、その Chrome を使う。
export async function launch() {
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required",
    ],
  });
}

export async function openPage(browser, url, { width = 1000, height = 700 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // 外部サイト（Google Fonts など）の読み込み失敗は環境依存なので数えない
  page.on("requestfailed", (r) => { if (r.url().startsWith(url)) errors.push(`load failed: ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction("window.__gpReady === true", { timeout: 240000 });
  return { page, errors };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// アニメーション時間で sec 秒進むまで待つ（GPU のない環境ではフレームレートが極端に低いため）
export async function waitGameTime(page, sec) {
  const t0 = await page.evaluate(() => guineaPig.time);
  await page.waitForFunction((t) => guineaPig.time >= t, { timeout: 300000, polling: 50 }, t0 + sec);
}
