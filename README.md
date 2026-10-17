# Guinea Pig 3D (Babylon.js)

A browser demo of a tricolor guinea pig 3D model with fur, idle/walk animations, and synthesized squeaks. It is being built as the foundation for a web game.

**Demo: https://algas.github.io/guinea-pig-game/**

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

- Drag to rotate; pinch or use the mouse wheel to zoom
- Buttons at the bottom: switch between idle / walk, squeak, toggle sound, fur, and bone display
- Tap the guinea pig to pet it, and it will purr

## Checks

```bash
npm run build
npm run check     # Validates the GLB and runs a headless-browser smoke test (screenshots in .artifacts/)
npm run voices    # Writes the squeak sounds to .artifacts/ as WAV files
```

Development details are in [CLAUDE.md](CLAUDE.md), and the project history is in [docs/HISTORY.md](docs/HISTORY.md) (both in Japanese).
