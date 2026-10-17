# モルモット 3D（Babylon.js）

三毛のモルモットの 3D モデルを、毛並み・待機/歩行アニメーション・鳴き声つきでブラウザに表示するデモです。Web ゲームの土台として作っています。

**デモ：https://algas.github.io/guinea-pig-game/**

## 動かし方

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開きます。

- ドラッグで回転、ピンチやホイールで拡大縮小
- 画面下のボタン：待機 / 歩行の切り替え、鳴く、音のオン・オフ、毛並み、ボーン表示
- モルモットをタップすると、なでられてグルグル鳴きます

## 検証

```bash
npm run build
npm run check     # GLB の検証とヘッドレスブラウザでの動作確認（.artifacts/ にスクリーンショット）
npm run voices    # 鳴き声を .artifacts/ に WAV で書き出し
```

開発の詳しい情報は [CLAUDE.md](CLAUDE.md)、これまでの経緯は [docs/HISTORY.md](docs/HISTORY.md) にあります。
