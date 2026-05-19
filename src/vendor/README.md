# Vendored runtime assets

## ort/ — onnxruntime-web v1.20

Used by the offscreen document (`src/offscreen/offscreen.js`) to run the
Milo ONNX embedder. Downloaded from
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/:

| File | What it is |
|---|---|
| `ort.min.mjs` | JS API (ESM) |
| `ort-wasm-simd-threaded.mjs` | WASM loader shim |
| `ort-wasm-simd-threaded.wasm` | WASM kernels (~11 MB) |
| `ort-wasm-simd-threaded.jsep.mjs` | JSEP (WebGPU) loader shim |
| `ort-wasm-simd-threaded.jsep.wasm` | JSEP kernels (~21 MB) |

We only need the non-JSEP WASM for CPU inference; the JSEP files are
included so ORT's runtime probe doesn't fail when looking for them. If size
matters later, the JSEP files can be deleted.

License: MIT.
