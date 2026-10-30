import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const perlin = new ImprovedNoise();

// Tileable fractal noise: blend four shifted copies so the edges wrap seamlessly.
function tileNoise(size, scale, octaves, seed) {
  const out = new Float32Array(size * size);
  const raw = (x, y) => {
    let a = 1, f = scale / size, s = 0, n = 0;
    for (let o = 0; o < octaves; o++) {
      s += a * perlin.noise(x * f, y * f, seed + o * 11.7);
      n += a; a *= 0.5; f *= 2;
    }
    return s / n;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const v00 = raw(x, y), v10 = raw(x - size, y), v01 = raw(x, y - size), v11 = raw(x - size, y - size);
      out[y * size + x] = (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
    }
  }
  // normalise to 0..1
  let mn = Infinity, mx = -Infinity;
  for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / (mx - mn);
  return out;
}

function toCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b, a = 255] = fn(i);
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function heightToNormal(h, size, strength) {
  return toCanvas(size, (i) => {
    const x = i % size, y = (i / size) | 0;
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
    const nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    return [(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (nz / len * 0.5 + 0.5) * 255];
  });
}

function finish(tex, repeat, srgb) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Ground detail: grainy albedo modulation + normal map. */
export function makeGroundTextures(repeat) {
  const size = 512;
  const coarse = tileNoise(size, 6, 5, 1.3);
  const fine = tileNoise(size, 48, 3, 7.1);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    // pebbly / cracked look: ridge of coarse plus fine grain
    const ridge = 1 - Math.abs(coarse[i] * 2 - 1);
    h[i] = ridge * 0.55 + fine[i] * 0.45;
  }
  const albedo = toCanvas(size, (i) => {
    const v = 150 + h[i] * 105;
    return [v, v, v];
  });
  return {
    map: finish(new THREE.CanvasTexture(albedo), repeat, true),
    normalMap: finish(new THREE.CanvasTexture(heightToNormal(h, size, 6)), repeat, false),
  };
}

/** Stone / rock detail with strata and cracks. */
export function makeRockTextures(repeat) {
  const size = 512;
  const n1 = tileNoise(size, 4, 6, 3.3);
  const n2 = tileNoise(size, 24, 4, 9.9);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    const y = (i / size) | 0;
    const strata = Math.sin((y / size) * Math.PI * 2 * 7 + n1[i] * 9) * 0.5 + 0.5;
    const crack = Math.pow(1 - Math.abs(n2[i] * 2 - 1), 8);
    h[i] = n1[i] * 0.55 + strata * 0.25 + n2[i] * 0.2 - crack * 0.35;
  }
  const albedo = toCanvas(size, (i) => {
    const v = 145 + h[i] * 80;
    return [v * 1.02, v, v * 0.95];
  });
  const rough = toCanvas(size, (i) => {
    const v = 190 + n2[i] * 65;
    return [v, v, v];
  });
  return {
    map: finish(new THREE.CanvasTexture(albedo), repeat, true),
    normalMap: finish(new THREE.CanvasTexture(heightToNormal(h, size, 9)), repeat, false),
    roughnessMap: finish(new THREE.CanvasTexture(rough), repeat, false),
  };
}

/** Wave normal map for the water surface. */
export function makeWaterNormals() {
  const size = 512;
  const a = tileNoise(size, 8, 5, 21.1);
  const b = tileNoise(size, 20, 4, 33.4);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.6 + b[i] * 0.4;
  const t = finish(new THREE.CanvasTexture(heightToNormal(h, size, 10)), 1, false);
  return t;
}

/** Soft, slightly lumpy particle sprite. */
export function makeParticleTexture() {
  const size = 128;
  const n = tileNoise(size, 6, 4, 51.5);
  const c = toCanvas(size, (i) => {
    const x = (i % size) / size - 0.5, y = ((i / size) | 0) / size - 0.5;
    const d = Math.hypot(x, y) * 2;
    const fall = Math.max(0, 1 - d);
    const a = Math.pow(fall, 1.6) * (0.65 + n[i] * 0.7);
    return [255, 255, 255, Math.min(255, a * 255)];
  });
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
