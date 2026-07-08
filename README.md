# Foxy's Premium Upscaling

**Free · Private · One-click** browser video & image upscaler.

Choose a file → **Enhance** → compare → **Download**.  
Processing is **100% on-device** (WebGL). No signup. No upload. No watermark.

**Live:** https://foxys-lab.github.io/foxys-premium-upscaling/

---

## How it works

```
File → WebSR Anime4K CNN (WebGPU) 2× → compare / download
              ↑ same engine family as free.upscaler.video
         fallback: multi-pass WebGL if no WebGPU
```

**Primary engine:** [`@websr/websr`](https://github.com/sb2702/websr) — WebGPU neural nets from **Anime4K** (default **cnn-2x-l** animation weights), the same stack free.upscaler.video is built on.

**Fallback:** multi-pass WebGL (clarity / CAS / lines) if WebGPU is missing.

- **Images** → PNG or JPEG + before/after scrubber  
- **Video** → WebM via MediaRecorder (AI path when WebGPU available)  

Weights (MIT, from WebSR): `public/weights/anime4k/cnn-2x-*-an.json`

---

## Use it

1. Open the [live site](https://foxys-lab.github.io/foxys-premium-upscaling/) (Chrome or Edge recommended)  
2. Choose an image or short video  
3. Press **Enhance**  
4. Drag the compare slider (images)  
5. **Download**

---

## Develop

```bash
git clone https://github.com/foxys-lab/foxys-premium-upscaling.git
cd foxys-premium-upscaling
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

Requires Node 20+.

---

## Browser support

| Feature | Need |
|---------|------|
| Enhance images | WebGL |
| Enhance video | WebGL + MediaRecorder |
| Best experience | Chrome / Edge desktop |

---

## Project layout

```
src/
  lib/enhance/   # WebGL engine, image + video paths
  lib/           # capabilities, jobs
  ui/            # dropzone, compare, progress
  App.tsx        # simple one-click UX
```

---

## License

MIT · © Foxy's Lab

Not affiliated with free.upscaler.video or Topaz Labs.
