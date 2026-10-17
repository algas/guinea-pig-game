# CLAUDE.md

モルモット（三毛のイングリッシュ系）を主役にした Web ゲームのプロジェクト。
今は「ゲーム本体」の前段階で、**3Dモデル・毛並み・待機/歩行アニメーション・鳴き声**が Babylon.js 上で動くデモまでできている。
これまでの経緯と判断の理由は `docs/HISTORY.md` にある。

- UI の文言・コメントは日本語で書く（利用者は日本語話者）
- 見た目の基準は `docs/reference/guinea-pig-photo.jpg`（白い鼻筋、目のまわりと頬がオレンジ、左耳側の頭頂に黒ぶち、白い首、オレンジの背中、白い帯、黒いお尻）

## コマンド

```bash
npm install            # 初回のみ
npm run dev            # 開発サーバー（http://localhost:5173）
npm run build          # dist/ に書き出し
npm run check          # GLB 検証 + スモークテスト（先に build が必要）
npm run voices         # 鳴き声を .artifacts/voice-*.wav に書き出す（先に build が必要）
npm run model          # 3Dモデルを再生成（Python。下記参照）
```

モデル生成の準備（Python 3.10+）:
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r tools/model/requirements.txt
```

## ファイル構成

```
index.html                 画面の骨組み（タイトル、操作ボタン、canvas）
src/main.js                シーン・ライト・床・モデル読み込み・シェルファー・アニメーション・UI（すべてここ）
src/voice.js               鳴き声の合成（Web Audio。外部音源なし）
src/style.css              画面のスタイル（ライト/ダーク対応）
src/model/landmarks.json   目と鼻の位置（generate_model.py が出力。毛を短くする場所に使う）
public/models/guinea_pig.glb  3Dモデル（generate_model.py が出力）
tools/model/generate_model.py モデル生成（SDF → マーチングキューブ → 頂点カラー → ボーン/ウェイト → GLB）
tools/check/*.mjs          検証（GLB 検証、ヘッドレス Chrome でのスモークテスト、WAV 書き出し）
docs/                      経緯と参照写真
```

## 座標系・単位

- 単位 m（実寸。全長約 31cm）、**Y-up、前方 +Z**、原点は足元中央
- Babylon は左手系だが、glTF ローダーが `__root__` で反転を吸収している。ボーン操作はボーンのローカル空間で行うので意識しなくてよい

## 3Dモデル（public/models/guinea_pig.glb）

- メッシュは 3 つ：`fur_body`（胴〜頭〜口元の一体メッシュ、毛を生やす）、`skin_parts`（耳・鼻・足）、`eyes`
- 模様は**頂点カラー COLOR_0（リニア値）**。StandardMaterial に渡すため `main.js` で読み込み後にガンマ補正している。テクスチャは使っていない
- 約 3.5 万三角形。glTF 公式バリデーターでエラー・警告 0 を維持すること（`npm run check:glb`）
- `generate_model.py` は乱数シード固定なので、同じコードなら**バイト単位で同じ GLB** が出る。形や模様を変えたら `npm run model` で GLB と landmarks.json を一緒に更新する
- 形状は `body_sdf()` の楕円体の組み合わせ（smooth-min で融合）。模様は `coat()`、耳は `petal_ear()`

### ボーン（11 本）

```
root ─ hips ─┬ leg_back.L / leg_back.R
             └ chest ─┬ leg_front.L / leg_front.R
                      └ head ─┬ nose
                              ├ ear.L
                              └ ear.R
```
- `root` を動かすと全体が移動・回転する（歩行の移動は root の位置と向き）
- 胴体のウェイトは hips → chest → head → nose へ z 方向になめらかに移る。足の付け根まわりは足ボーンにも少し乗る
- 耳・鼻・足・目は対応するボーンに 100% 固定

## 毛並み（シェルファー）

- `fur_body` を `SHELLS` 枚複製し、各層を `CustomMaterial` で法線方向に押し出して、ハッシュノイズで毛の断面以外を `discard` している（`main.js` の `furMaterial(h)`）
- 層の数：PC 30 / タッチ端末 18。URL の `?shells=N` で上書きできる（0 で毛なし）。描画負荷は層の数にほぼ比例する
- 毛の長さは場所で変えている：鼻先・口元は短く、目のまわり（landmarks.eye）と鼻（landmarks.nose）の近くはほぼ 0、お腹側も短い。毛は後ろ下方向に寝かせている（`comb`）
- **毛は Babylon のシェーダーなので GLB 単体には入っていない**。別のエンジンでは毛のない体として表示される

## アニメーション（すべて手続き的。キーフレームなし）

`scene.onBeforeRenderObservable` の中で毎フレーム計算している。状態は `g` オブジェクトにまとまっている。

- 状態は `idle`（待機）と `walk`（歩行）。`w`（歩いている度合い 0..1）で 2 つの動きをなめらかに混ぜる
- 歩行：ランダムな目的地（半径 `ROAM_RADIUS` 内）へ向かい、着いたら次を選ぶ。対角の足が同時に出るトロット風。`WALK_SPEED`（m/s）と `STEP_FREQ`（歩/秒）で調整
- 待機：呼吸（chest/hips のスケール）、見回し、鼻ひくひく、耳ぴくっ
- ボーン操作は `setRot(name, x, y, z)` / `setPos` / `setScale`。いずれも**休止姿勢からの差分**
- ⚠️ `head` の回転 x（ピッチ）は**正で鼻先が下がる、負で上がる**（実測済み）
- `dt` は 0.05 秒で頭打ちにしている（タブ復帰時の飛び防止）。そのため低フレームレートでは時間がゆっくり進む
- カメラと接地影（`contactAO`）は root に追従する

## 鳴き声（src/voice.js）

- 3 種類を合成：`wheek`（ウィーク。高く上がる声を 2〜5 回）、`purr`（グルグル。約 20Hz で震える低い声）、`chut`（クックッ。短いつぶやき）
- `pattern(kind)` がイベント列（各音の開始時刻・長さ・音程）を作り、**音とアニメーションが同じ列を見て動く**（鳴くと頭を上げる、グルグルで体が震える）
- ブラウザの自動再生制限のため、最初のタップ/キー入力で `GPVoice.unlock()` するまで音は出ない
- 画面上の左右位置とカメラからの距離で、パンと音量を変えている
- Claude は音を聞けないので、**音を変えたら `npm run voices` で WAV を書き出し、利用者に聞いてもらう**。スペクトログラムで形を確認するのは有効

## ゲームから使う API（window.guineaPig）

```js
guineaPig.setState("walk");      // "idle" | "walk"
guineaPig.say("wheek");          // "wheek" | "purr" | "chut"
guineaPig.state;                 // 現在の状態
guineaPig.calling;               // 鳴いている最中の種類（なければ null）
guineaPig.position;              // { x, z, heading }
guineaPig.time;                  // アニメーション上の経過秒
guineaPig.sound.setMuted(true);  // setVolume(0..1) も可
```
UI 操作：本体をタップすると「なでる」扱いでグルグル（たまにウィーク）。歩行中はときどきクックッ、待機中もたまに自分から鳴く。

## 検証のしかた

変更したら最低でも `npm run build && npm run check` を通す。見た目に関わる変更では、**`.artifacts/` のスクリーンショットを実際に見て確認する**（desktop-idle / desktop-walk / desktop-wheek / mobile）。

- スモークテストはヘッドレス Chrome で、歩行で前進する・待機で止まる・鳴くと頭が上がる・床のタップでは鳴かず本体のタップで鳴く・エラーがない、を確認する
- 動きの検証は `?shells=6` で軽くし、**実時間ではなく `guineaPig.time`（アニメーション時間）で待つ**。GPU のない環境では毎秒数コマしか出ないため、実時間で待つと失敗する
- GPU のない Linux などでは WebGL を SwiftShader で動かす設定にしてある。手元の Chrome を使う場合は `CHROME_PATH=/path/to/chrome npm run check:smoke`
- 外部サイト（Google Fonts）の読み込み失敗はエラーとして数えない

## 既知の課題・次にやりそうなこと

- **バンドルが大きい（約 9.5MB、gzip 2MB）**：UMD 版の `babylonjs` を丸ごと読んでいるため。`@babylonjs/core` などの ES モジュール版に移すと、使う分だけに減らせる（`CustomMaterial` は `@babylonjs/materials`）
- `main.js` が 1 ファイルに全部入っている。ゲームを作り始めたら、シーン / 毛 / モルモット（アニメ・状態）/ UI に分けるとよい
- 歩行は足の接地を計算していない（IK なし）ので、旋回時などに足が少し滑って見える
- 当たり判定・障害物・地形はない。移動範囲は半径 `ROAM_RADIUS` の円
- 模様は頂点カラーなので細かい柄は描けない。細部を描き込むならテクスチャ（UV）方式への変更が必要
- 古いスマホではシェルファーが重い可能性がある（`?shells=` で調整）

## 公開版

claude.ai 上の公開デモ（このリポジトリと同じ内容の 1 ファイル版）：
https://claude.ai/artifact/B2VCUKWvdykHMDEhqWcZ4D
