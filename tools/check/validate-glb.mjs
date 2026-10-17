// glTF 公式バリデーターで GLB を検証する
import { readFileSync } from "node:fs";
import validator from "gltf-validator";

const file = process.argv[2] || "public/models/guinea_pig.glb";
const r = await validator.validateBytes(new Uint8Array(readFileSync(file)));
const i = r.issues;
console.log(`${file}: errors ${i.numErrors}, warnings ${i.numWarnings}, triangles ${r.info.totalTriangleCount}`);
for (const m of i.messages.slice(0, 10)) console.log(`  [${m.severity}] ${m.code} ${m.pointer ?? ""}`);
process.exit(i.numErrors > 0 ? 1 : 0);
