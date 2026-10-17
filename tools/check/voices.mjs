// 鳴き声を WAV に書き出す（npm run build のあとに実行）。耳で確かめる用。
// 出力: .artifacts/voice-wheek.wav など
import { writeFileSync } from "node:fs";
import path from "node:path";
import { OUT, startServer, launch, openPage } from "./harness.mjs";

function wav(samples, sr) {
  let pk = 1e-6; for (const x of samples) pk = Math.max(pk, Math.abs(x));
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((x, i) => buf.writeInt16LE(Math.round((x / pk) * 0.9 * 32767), 44 + i * 2));
  return buf;
}

const { server, url } = await startServer();
const browser = await launch();
try {
  const { page } = await openPage(browser, url, { width: 400, height: 300 });
  for (const kind of ["wheek", "purr", "chut"]) {
    const r = await page.evaluate(async (k) => {
      const { buffer } = await GPVoice.render(k);
      return { data: Array.from(buffer.getChannelData(0)), sr: buffer.sampleRate };
    }, kind);
    const file = path.join(OUT, `voice-${kind}.wav`);
    writeFileSync(file, wav(r.data, r.sr));
    console.log("wrote", path.relative(process.cwd(), file), `${(r.data.length / r.sr).toFixed(2)}s`);
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
