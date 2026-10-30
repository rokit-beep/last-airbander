import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeGroundTextures, makeRockTextures, makeWaterNormals } from './textures.js';

export const WORLD_SIZE = 900;
export const WORLD_RADIUS = 420;
export const SHRINE_RADIUS = 10.5;
export const SHRINE_TOP = 9.8;

const perlin = new ImprovedNoise();
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function fbm(x, z, oct = 6) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * perlin.noise(x * f, z * f, 0.5 + i * 7.3);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

/** Raw terrain height (metres) at world x/z. */
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const island = 1 - smooth(250, 410, r + fbm(x * 0.004 + 9, z * 0.004, 3) * 90);
  let h = 7 + fbm(x * 0.006, z * 0.006, 6) * 34;
  const ridge = 1 - Math.abs(perlin.noise(x * 0.0045 + 31, z * 0.0045 - 17, 2.2));
  const mountain = smooth(90, 230, r);
  h += Math.pow(ridge, 3) * 105 * mountain;
  // eroded gullies and crags on the mountain flanks
  const crag = 1 - Math.abs(perlin.noise(x * 0.021, z * 0.021, 6.6));
  const crag2 = 1 - Math.abs(perlin.noise(x * 0.055, z * 0.055, 9.1));
  h += (crag * crag * 16 + crag2 * crag2 * 4) * mountain * (0.25 + ridge * ridge);
  const plateau = 1 - smooth(16, 52, r);
  h = h * (1 - plateau) + 9 * plateau;
  return h * island - 16 * (1 - island);
}

/** Walkable ground height including the shrine platform. */
export function groundAt(x, z) {
  const h = heightAt(x, z);
  const r = Math.hypot(x, z);
  if (r < SHRINE_RADIUS) return Math.max(h, SHRINE_TOP);
  if (r < SHRINE_RADIUS + 3) {
    // three steps down from the platform
    const step = Math.ceil((r - SHRINE_RADIUS) / 1.0);
    return Math.max(h, SHRINE_TOP - step * 0.27);
  }
  return h;
}

export function slopeAt(x, z) {
  const e = 1.5;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// Two-scale detail sampling to hide texture tiling.
function antiTile(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 dA = texture2D( map, vMapUv );
        vec4 dB = texture2D( map, vMapUv * 0.137 + 0.31 );
        diffuseColor.rgb *= mix( dA.rgb, dB.rgb, 0.45 ) * 1.25;
      #endif`
    );
  };
}

export function buildTerrain() {
  const seg = 380;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const sandWet = srgb(0.46, 0.41, 0.33), sand = srgb(0.78, 0.70, 0.54), deep = srgb(0.34, 0.33, 0.28);
  const grassA = srgb(0.27, 0.36, 0.13), grassB = srgb(0.40, 0.44, 0.18), dryGrass = srgb(0.55, 0.50, 0.30);
  const dirt = srgb(0.40, 0.32, 0.22), rock = srgb(0.43, 0.40, 0.37), rockDark = srgb(0.30, 0.28, 0.27);
  const snow = srgb(0.93, 0.94, 0.97);
  const c = new THREE.Color(), tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = nrm.getY(i);
    const n1 = perlin.noise(x * 0.03, z * 0.03, 4.4) * 0.5 + 0.5;
    const n2 = perlin.noise(x * 0.008, z * 0.008, 8.8) * 0.5 + 0.5;

    if (y < -3) c.copy(deep);
    else if (y < 0.7) c.copy(sandWet).lerp(sand, smooth(-3, 0.7, y) * 0.6);
    else if (y < 2.6) c.copy(sand).lerp(grassB, smooth(1.8, 2.6, y));
    else {
      c.copy(grassA).lerp(grassB, n1);
      c.lerp(dryGrass, smooth(0.45, 0.8, n2) * 0.7);
      c.lerp(dirt, smooth(0.55, 0.9, n1 * (1 - ny) * 3));
    }
    // rocky steep slopes and high altitude
    const rockAmt = Math.max(smooth(0.86, 0.72, ny), smooth(50, 75, y));
    if (y > 0.7 && rockAmt > 0) {
      const strata = Math.sin(y * 0.55 + n1 * 4 + n2 * 6) * 0.5 + 0.5;
      tmp.copy(rock).lerp(rockDark, n1 * 0.6 + strata * 0.4);
      c.lerp(tmp, rockAmt);
    }
    const snowAmt = smooth(82, 100, y + n1 * 12) * smooth(0.55, 0.8, ny);
    c.lerp(snow, snowAmt);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const tex = makeGroundTextures(160);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.93,
    metalness: 0,
  });
  antiTile(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildSky(renderer, scene, sunDir) {
  const setup = (sky) => {
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.0045;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sunDir).multiplyScalar(1000);
    return sky;
  };
  const sky = setup(new Sky());
  scene.add(sky);

  // environment lighting from the same sky
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(setup(new Sky()));
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  return sky;
}

export function buildClouds(sunDir) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: sunDir.clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSun;
      varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float s = 0.0, a = 0.5;
        for(int i=0;i<6;i++){ s += a*noise(p); p = p*2.03 + vec2(1.7,9.2); a *= 0.5; }
        return s;
      }
      void main(){
        vec2 p = vWorld.xz * 0.0011 + vec2(uTime*0.004, uTime*0.0015);
        float d = fbm(p);
        float cov = smoothstep(0.48, 0.78, d);
        // fake self shadowing: sample towards the sun
        float d2 = fbm(p + uSun.xz * 0.04);
        float shade = clamp(0.55 + (d - d2) * 3.0, 0.25, 1.0);
        vec3 lit = vec3(1.0, 0.86, 0.70) * 1.6;
        vec3 dark = vec3(0.42, 0.45, 0.55);
        vec3 col = mix(dark, lit, shade);
        float dist = length(vWorld.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(1500.0, 3800.0, dist);
        gl_FragColor = vec4(col, cov * fade * 0.92);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat);
  mesh.rotation.x = Math.PI / 2; // face down
  mesh.position.y = 420;
  mesh.renderOrder = -1;
  return mesh;
}

export function buildWater(sunDir, res = 1024) {
  const normals = makeWaterNormals();
  const water = new Water(new THREE.PlaneGeometry(5000, 5000), {
    textureWidth: res,
    textureHeight: res,
    waterNormals: normals,
    sunDirection: sunDir.clone(),
    sunColor: 0xffe8c8,
    waterColor: 0x08313d,
    distortionScale: 2.4,
    alpha: 1.0,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.material.uniforms.size.value = 3.0;
  return water;
}

// ---------- Vegetation ----------

function bladeTuft() {
  const blades = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const h = 0.45 + Math.random() * 0.45;
    const g = new THREE.PlaneGeometry(0.07, h, 1, 3);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    const lean = (Math.random() - 0.5) * 0.5;
    for (let v = 0; v < p.count; v++) {
      const t = p.getY(v) / h;
      p.setX(v, p.getX(v) * (1 - t * 0.92));
      p.setZ(v, p.getZ(v) + t * t * lean);
    }
    g.rotateY(Math.random() * Math.PI);
    g.translate((Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35);
    // vertical gradient: dark roots, bright tips
    const col = new Float32Array(p.count * 3);
    const base = srgb(0.08, 0.13, 0.04), tip = srgb(0.48, 0.55, 0.22);
    const tc = new THREE.Color();
    for (let v = 0; v < p.count; v++) {
      tc.copy(base).lerp(tip, Math.pow(Math.max(0, p.getY(v) / h), 0.8));
      col[v * 3] = tc.r; col[v * 3 + 1] = tc.g; col[v * 3 + 2] = tc.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    blades.push(g);
  }
  const merged = mergeGeometries(blades);
  // upward normals so grass shades like the ground it grows on
  const n = merged.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return merged;
}

export function buildGrass(windUniform, density = 1) {
  const geo = bladeTuft();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.75,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 ip = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
       float k = position.y * position.y;
       float w = sin(uTime*1.6 + ip.x*0.31 + ip.z*0.17) * 0.6 + sin(uTime*3.7 + ip.x*1.3 + ip.z*0.9) * 0.18;
       transformed.x += w * k * 0.35;
       transformed.z += w * k * 0.18;`
    );
  };
  const N = Math.round(42000 * density);
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < N && tries < N * 6) {
    tries++;
    const r = Math.sqrt(Math.random()) * 175;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z) < SHRINE_RADIUS + 3.5) continue;
    const h = heightAt(x, z);
    if (h < 2.4 || h > 48) continue;
    if (slopeAt(x, z) > 0.55) continue;
    // patchy meadows
    if (perlin.noise(x * 0.05, z * 0.05, 2.2) < -0.25) continue;
    p.set(x, h - 0.03, z);
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    const sc = 0.7 + Math.random() * 0.8;
    s.set(sc, sc * (0.8 + Math.random() * 0.6), sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    const dry = perlin.noise(x * 0.008, z * 0.008, 8.8) * 0.5 + 0.5;
    col.setRGB(0.85 + Math.random() * 0.25, 0.9 + Math.random() * 0.2, 0.8 + Math.random() * 0.2);
    col.lerp(new THREE.Color(1.35, 1.1, 0.7), Math.max(0, dry - 0.5) * 1.3);
    mesh.setColorAt(placed, col);
    placed++;
  }
  mesh.count = placed;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function rockGeometry(seed, detail = 4) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = perlin.noise(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4) * 0.35
      + perlin.noise(v.x * 4 + seed, v.y * 4, v.z * 4) * 0.08;
    v.multiplyScalar(1 + n);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3; // flatter base
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

let rockMaterial;
export function getRockMaterial() {
  if (!rockMaterial) {
    const t = makeRockTextures(2);
    rockMaterial = new THREE.MeshStandardMaterial({
      color: 0x9a948b,
      map: t.map,
      normalMap: t.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: t.roughnessMap,
      roughness: 1,
      metalness: 0,
    });
  }
  return rockMaterial;
}

export const rockGeos = [rockGeometry(1.3), rockGeometry(7.7), rockGeometry(15.1)];

export function buildRocks() {
  const group = new THREE.Group();
  const mat = getRockMaterial();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  rockGeos.forEach((geo, gi) => {
    const N = 140;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    let placed = 0;
    for (let t = 0; t < N * 10 && placed < N; t++) {
      const r = 20 + Math.random() * 380;
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = heightAt(x, z);
      if (h < -1.5) continue;
      const big = Math.random() < 0.15;
      const sc = big ? 2.5 + Math.random() * 4 : 0.3 + Math.random() * 1.2;
      e.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4);
      q.setFromEuler(e);
      s.set(sc * (0.8 + Math.random() * 0.6), sc * (0.6 + Math.random() * 0.5), sc * (0.8 + Math.random() * 0.6));
      p.set(x, h - sc * (0.15 + slopeAt(x, z) * 0.5), z);
      m.compose(p, q, s);
      mesh.setMatrixAt(placed++, m);
    }
    mesh.count = placed;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

// Fir branch sprite: a stem with sub-twigs covered in needles, on a transparent background.
function branchTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  const needle = (x, y, a, len) => {
    const l = 0.12 + Math.random() * 0.14, hue = 88 + Math.random() * 30;
    ctx.strokeStyle = `hsl(${hue}, ${30 + Math.random() * 25}%, ${l * 100}%)`;
    ctx.lineWidth = 1.6 + Math.random();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  };
  const twig = (x0, y0, ang, len, nlen) => {
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); ctx.stroke();
    for (let d = 0; d < len; d += 2.2) {
      const x = x0 + Math.cos(ang) * d, y = y0 + Math.sin(ang) * d;
      const taper = 1 - (d / len) * 0.6;
      for (const side of [-1, 1]) needle(x, y, ang + side * (0.75 + Math.random() * 0.4), nlen * taper * (0.7 + Math.random() * 0.5));
    }
  };
  // twigs fanning out from the main stem
  for (let x = 20; x < 470; x += 26) {
    const k = 1 - x / 520;
    for (const side of [-1, 1]) twig(x, 128, side * (0.55 + Math.random() * 0.25), 110 * k, 15);
  }
  twig(0, 128, 0, 500, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pineGeometry() {
  const parts = [];
  // dense inner cone so the canopy reads as solid from afar
  const core = new THREE.ConeGeometry(1.5, 9.5, 10, 6, true);
  core.translate(0, 2.4 + 4.75, 0);
  parts.push(core);
  const layers = 11;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = 2.0 + t * 9.0;
    const len = 3.0 * (1 - t * 0.85) + 0.5;
    const cards = 10 - Math.floor(t * 4);
    for (let k = 0; k < cards; k++) {
      const g = new THREE.PlaneGeometry(len, len * 0.85, 5, 1);
      g.translate(len / 2, 0, 0);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const u = p.getX(v) / len;
        p.setY(v, p.getY(v) + 0.25 * len * u - u * u * len * 0.55); // lift then droop
      }
      g.rotateZ((Math.random() - 0.5) * 0.25);
      g.rotateY((k / cards) * Math.PI * 2 + i * 0.73 + Math.random() * 0.35);
      g.translate(0, y + (Math.random() - 0.5) * 0.4, 0);
      parts.push(g);
    }
  }
  const foliage = mergeGeometries(parts);
  // soft "canopy" normals pointing outwards and up
  const p = foliage.attributes.position, n = foliage.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), 0.9, p.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return foliage;
}

export function buildTrees(count = 700) {
  const group = new THREE.Group();
  const foliageGeo = pineGeometry();
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.34, 10, 8);
  trunkGeo.translate(0, 5, 0);
  const needles = branchTexture();
  const foliageMat = new THREE.MeshStandardMaterial({
    map: needles, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0xd8e0c8,
  });
  const t = makeRockTextures(1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: srgb(0.33, 0.24, 0.17), map: t.map, normalMap: t.normalMap, roughness: 1 });
  const N = count;
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, N);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const colliders = [];
  let placed = 0;
  for (let tr = 0; tr < N * 20 && placed < N; tr++) {
    const r = 60 + Math.random() * 345;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 3 || h > 62) continue;
    if (slopeAt(x, z) > 0.7) continue;
    if (perlin.noise(x * 0.012, z * 0.012, 5.5) < 0.05) continue; // forest clusters
    const sc = 0.75 + Math.random() * 0.9;
    p.set(x, h - 0.3, z);
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    s.set(sc, sc * (0.9 + Math.random() * 0.3), sc);
    m.compose(p, q, s);
    foliage.setMatrixAt(placed, m);
    trunks.setMatrixAt(placed, m);
    col.setHSL(0.2 + Math.random() * 0.08, 0.35, 0.55 + Math.random() * 0.25);
    foliage.setColorAt(placed, col);
    colliders.push({ x, z, r: 0.5 * sc });
    placed++;
  }
  foliage.count = trunks.count = placed;
  foliage.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: needles, alphaTest: 0.45, side: THREE.DoubleSide,
  });
  for (const im of [foliage, trunks]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }
  return { group, colliders };
}

// ---------- The ruined shrine ----------

export function buildShrine() {
  const group = new THREE.Group();
  const t = makeRockTextures(3);
  const stone = new THREE.MeshStandardMaterial({
    color: 0xc9bea8, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1,
  });
  const add = (geo, x, y, z, ry = 0) => {
    const mesh = new THREE.Mesh(geo, stone);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // platform and steps
  add(new THREE.CylinderGeometry(SHRINE_RADIUS, SHRINE_RADIUS + 0.2, 3, 48), 0, SHRINE_TOP - 1.5, 0);
  for (let i = 1; i <= 3; i++) {
    const r = SHRINE_RADIUS + i;
    add(new THREE.CylinderGeometry(r, r + 0.1, 3, 48), 0, SHRINE_TOP - 1.5 - i * 0.27, 0);
  }
  // inlaid ring pattern on the floor
  const inlay = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 3.7, 64),
    new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.45, metalness: 0.6 })
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = SHRINE_TOP + 0.01;
  inlay.receiveShadow = true;
  group.add(inlay);

  const colliders = [];
  const count = 10;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * 8.3, z = Math.sin(a) * 8.3;
    const broken = i === 2 || i === 6 || i === 7;
    const h = broken ? 1.6 + Math.random() * 2.2 : 6.5;
    add(new THREE.BoxGeometry(1.4, 0.45, 1.4), x, SHRINE_TOP + 0.22, z, a);
    const col = add(new THREE.CylinderGeometry(0.48, 0.55, h, 18, 6), x, SHRINE_TOP + 0.45 + h / 2, z);
    // fluting wobble so columns look hand-carved
    const p = col.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const ang = Math.atan2(p.getZ(k), p.getX(k));
      const f = 1 + Math.sin(ang * 12) * 0.03 + (Math.random() - 0.5) * 0.02;
      p.setX(k, p.getX(k) * f); p.setZ(k, p.getZ(k) * f);
    }
    col.geometry.computeVertexNormals();
    if (!broken) add(new THREE.BoxGeometry(1.3, 0.5, 1.3), x, SHRINE_TOP + 0.45 + h + 0.25, z, a);
    else {
      // fallen chunk lying beside the column
      const chunk = add(new THREE.CylinderGeometry(0.48, 0.48, 2.2, 18), x * 1.25, 0, z * 1.25);
      chunk.rotation.z = Math.PI / 2;
      chunk.rotation.y = a + 0.6;
      chunk.position.y = groundAt(x * 1.25, z * 1.25) + 0.42;
    }
    colliders.push({ x, z, r: 0.75 });
  }
  // architrave beams between intact neighbouring columns
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    if ([2, 6, 7].includes(i) || [2, 6, 7].includes(j)) continue;
    const a0 = (i / count) * Math.PI * 2, a1 = (j / count) * Math.PI * 2;
    const x0 = Math.cos(a0) * 8.3, z0 = Math.sin(a0) * 8.3, x1 = Math.cos(a1) * 8.3, z1 = Math.sin(a1) * 8.3;
    const len = Math.hypot(x1 - x0, z1 - z0) + 1.2;
    const beam = add(new THREE.BoxGeometry(len, 0.7, 1.0), (x0 + x1) / 2, SHRINE_TOP + 7.8, (z0 + z1) / 2);
    beam.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  }
  // central brazier
  const bowlProfile = [];
  for (let i = 0; i <= 12; i++) {
    const t2 = i / 12;
    bowlProfile.push(new THREE.Vector2(0.25 + Math.sin(t2 * Math.PI * 0.5) * 1.1, t2 * 0.9));
  }
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5b4126, roughness: 0.4, metalness: 0.85 });
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlProfile, 40), bronze);
  bowl.material.side = THREE.DoubleSide;
  bowl.position.y = SHRINE_TOP + 1.25;
  bowl.castShadow = true;
  group.add(bowl);
  add(new THREE.CylinderGeometry(0.35, 0.7, 1.3, 16), 0, SHRINE_TOP + 0.65, 0);
  colliders.push({ x: 0, z: 0, r: 1.3 });
  const firePoint = new THREE.Vector3(0, SHRINE_TOP + 2.0, 0);
  return { group, colliders, firePoint };
}
