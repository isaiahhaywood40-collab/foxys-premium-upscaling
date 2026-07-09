# Foxy's Premium Upscaling

**Free · Private · Browser AI** video & image upscaler.

Real **WebGPU** super-resolution (Anime4K / WebSR) — same proven engine path as free browser upscalers, branded and themed for **Foxy's Lab**.

**Live:** https://foxys-lab.github.io/foxys-premium-upscaling/

## Features

- AI upscale in the browser (Chrome / Edge + WebGPU)
- Small / Medium / Large networks
- Before / after compare
- Free, no signup, no watermark
- 100% on-device processing

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:8080

```bash
npm run build
```

## Deploy (GitHub Pages)

```bash
GITHUB_PAGES=true npm run build
```

Then publish `dist/` (Actions workflow included).

## Stack

- Alpine.js UI
- WebSR (`@websr/websr`) for Anime4K CNN on WebGPU
- WebCodecs / mediabunny pipeline for video
- Webpack build

## License

MIT. See [LICENSE](LICENSE) for full notices (includes original MIT upstream attribution required by the license).

## Credits (libraries)

- [WebSR](https://github.com/sb2702/websr) / Anime4K algorithms  
- Upstream open-source free browser upscaler (MIT) — forked and rebranded as Foxy's Premium Upscaling  

Product name, dark theme, and GitHub home: **foxys-lab**.
