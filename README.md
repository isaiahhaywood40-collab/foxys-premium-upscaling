# Foxy's Premium Upscaling

**Private · Quality-first · Browser-only** AI video & image upscaler.

Drop a clip, pick a **quality preset**, tune the **multi-stage pipeline**, scrub **before/after**. Processing runs **100% on your device** — no signup, no watermark, no upload.

> Inspired by [free.upscaler.video](https://free.upscaler.video/) / [WebSR](https://github.com/sb2702/websr). Match free-tool friction; win on **output quality** and **product polish**.

**North star:** [docs/quality-and-polish.md](docs/quality-and-polish.md)

---

## Why this exists

Casual upscalers are either:

| Tool type | Problem |
|-----------|---------|
| Topaz / pro desktop | Expensive, install + GPU setup |
| Canva / “free” web | Signup, time limits, watermarks |
| Video2X / Waifu2x | Great models, painful setup |
| free.upscaler.video | Excellent frictionless free tier — we aim to match that and add **better quality stages, presets, and polish** |

**Wedge:** same privacy story, smarter defaults (Anime / Real / AI-gen / Face), multi-stage quality, calm premium UI.

---

## Features (roadmap)

### Quality + polish (priority)
- [x] Project scaffold (Vite + React + TypeScript)
- [x] Drag & drop + capability badges
- [x] Multi-stage pipeline model (deblock → SR → detail → temporal → face)
- [x] Presets: **Fast · Balanced · Anime · AI-gen · Face · Max**
- [x] Stage strength sliders + relative load hint
- [x] Before/after compare scrubber (images live; video frames next)
- [x] Stage-aware progress UI
- [ ] Real WebGPU / WebGL stage implementations
- [ ] One-frame preview before full video run
- [ ] Bitrate-aware encode + download
- [ ] Temporal + face models on device
- [ ] Fixture A/B vs free.upscaler.video
- [ ] GitHub Pages deploy

Batch / cloud / PWA wait until quality clearly wins on benchmarks.

---

## Quick start (local)

**Requirements:** Node 20+, modern Chrome or Edge (WebGPU).

```bash
git clone https://github.com/foxys-lab/foxys-premium-upscaling.git
cd foxys-premium-upscaling

npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build    # production build → dist/
npm run preview  # serve dist locally
```

---

## How it works

```
File → WebCodecs decode → quality stages (WebGPU) → encode → download
         (local)              (local GPU)              (local)
```

- **Decode / encode:** [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- **Upscale:** multi-stage WebGPU (see `docs/models.md`)
- **Privacy:** no upload. Media never leaves the device.

---

## Browser support

| Browser | Status |
|---------|--------|
| Chrome 113+ | Best (WebGPU) |
| Edge 113+ | Best (WebGPU) |
| Safari 16+ | Partial / fallback TBD |
| Firefox 130+ | Partial / fallback TBD |

Desktop recommended. Mobile works for short clips but is slower.

---

## GitHub

| | |
|--|--|
| **Issues** | Bug reports & feature ideas |
| **Discussions** | Design, models, UX |
| **PRs** | Welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) |
| **License** | [MIT](LICENSE) |

### Deploy to GitHub Pages (later)

Workflow: `.github/workflows/pages.yml` — enable **Settings → Pages → GitHub Actions** after the first green build. Base path: `/foxys-premium-upscaling/`.

---

## Project layout

```
foxys-premium-upscaling/
├── public/              # static assets
├── src/
│   ├── lib/             # codecs, gpu, models, pipeline
│   ├── ui/              # React components
│   ├── workers/         # Web Workers
│   ├── styles/
│   ├── App.tsx
│   └── main.tsx
├── docs/                # architecture, quality plan, model cards
├── .github/             # CI, issue templates
└── README.md
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep PRs focused; don’t commit large model binaries without discussion (use Git LFS or CDN).

---

## Disclaimer

Output quality depends on source material and your GPU. You’re responsible for rights to content you process. Not affiliated with free.upscaler.video or Topaz Labs.

---

## Credits

- Concept peer: [free-ai-video-upscaler](https://github.com/sb2702/free-ai-video-upscaler) / [WebSR](https://github.com/sb2702/websr)
- Algorithms (planned): [Anime4K](https://github.com/bloc97/Anime4K), [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)

**Foxy's Premium Upscaling** — quality-first, private, on-device.
