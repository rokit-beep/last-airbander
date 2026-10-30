import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  buildTerrain, buildSky, buildClouds, buildWater, buildGrass, buildRocks, buildTrees, buildShrine, groundAt,
} from './world.js';
import { Particles, LightPool } from './effects.js';
import { makeParticleTexture } from './textures.js';
import { Sfx } from './audio.js';
import { Player } from './player.js';
import { Spirit, Orb, randomSpawnPoint } from './enemies.js';
import { Bending, ELEMENTS } from './bending.js';

const params = new URLSearchParams(location.search);
const LOW = params.get('q') === 'low';
const MSAA = LOW || params.get('msaa') === '0' ? 0 : 4;
const GRASS = LOW ? 0 : Math.min(1, Math.max(0, parseFloat(params.get('grass') ?? '1')));
const $ = (id) => document.getElementById(id);
const setLoad = (pct, text) => { $('load-bar').style.width = pct + '%'; $('load-text').textContent = text; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb9bdb8, 0.0021);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 9000);

const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 14), THREE.MathUtils.degToRad(215));
const sun = new THREE.DirectionalLight(0xffdcb4, 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xb7cde6, 0x4d4033, 0.45));

const wind = { value: 0 };
let water, clouds, brazierLight, shrine;
const colliders = [];

async function buildWorld() {
  setLoad(10, 'Hemel en licht…');
  await nextFrame();
  buildSky(renderer, scene, sunDir);
  clouds = buildClouds(sunDir);
  scene.add(clouds);
  setLoad(25, 'Het eiland vormen…');
  await nextFrame();
  scene.add(buildTerrain());
  setLoad(45, 'Water…');
  await nextFrame();
  water = buildWater(sunDir);
  scene.add(water);
  setLoad(55, 'Rotsen en ruïnes…');
  await nextFrame();
  scene.add(buildRocks());
  shrine = buildShrine();
  scene.add(shrine.group);
  colliders.push(...shrine.colliders);
  brazierLight = new THREE.PointLight(0xff8a3a, 40, 30, 2);
  brazierLight.position.copy(shrine.firePoint);
  scene.add(brazierLight);
  setLoad(70, 'Bossen planten…');
  await nextFrame();
  const trees = buildTrees();
  scene.add(trees.group);
  colliders.push(...trees.colliders);
  if (GRASS > 0) {
    setLoad(85, 'Gras laten groeien…');
    await nextFrame();
    scene.add(buildGrass(wind, GRASS));
  }
}

// ---------- particles & lights ----------
const ptex = makeParticleTexture();
const fire = new Particles(7000, ptex, THREE.AdditiveBlending);
const sparks = new Particles(2500, ptex, THREE.AdditiveBlending);
const motes = new Particles(500, ptex, THREE.AdditiveBlending);
const smoke = new Particles(4000, ptex, THREE.NormalBlending);
const spray = new Particles(3000, ptex, THREE.NormalBlending);
const mist = new Particles(3000, ptex, THREE.NormalBlending);
const debris = new Particles(1500, ptex, THREE.NormalBlending);
const allParticles = [smoke, debris, spray, mist, fire, sparks, motes];
allParticles.forEach((p, i) => { p.points.renderOrder = 10 + i; scene.add(p.points); });
const lights = new LightPool(scene, 8);

// ---------- post processing ----------
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: MSAA });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.38, 0.55, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uHeal: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uHeal; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.13) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      // subtle chromatic aberration towards the edges
      float ca = dot(d,d) * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d*ca).b;
      // filmic grade: warm highlights, cool shadows
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(col, col * vec3(1.04,1.0,0.94), smoothstep(0.4,1.0,l));
      col = mix(col, col * vec3(0.94,0.99,1.06), 1.0 - smoothstep(0.0,0.4,l));
      col = mix(vec3(l), col, 1.06);
      float vig = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.8)));
      col *= mix(0.55, 1.0, vig);
      col = mix(col, vec3(0.6,0.02,0.0), uHurt * (1.0 - vig) * 0.85);
      col = mix(col, vec3(0.2,0.6,0.9), uHeal * (1.0 - vig) * 0.4);
      col += (hash(uv) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);

// ---------- game state ----------
const sfx = new Sfx();
const player = new Player();
player.colliders = colliders;
scene.add(player.group);

const game = {
  scene, player, lights, sfx, fire, sparks, smoke, spray, mist, debris,
  enemies: [], orbs: [], time: 0, shake: 0, score: 0, wave: 0,
  emitFire(pos, vel, life = 0.7, size = 0.7) {
    fire.emit({
      x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z,
      life: life * (0.7 + Math.random() * 0.6), size0: size * 0.9, size1: size * 1.8,
      c0: [3.4, 1.75, 0.6], c1: [0.9, 0.1, 0.02], alpha: 0.9, drag: 1.4, grav: 3.5, spin: 3,
    });
    if (Math.random() < 0.06) smoke.emit({
      x: pos.x, y: pos.y + 0.3, z: pos.z, vx: vel.x * 0.2, vy: 1.5, vz: vel.z * 0.2,
      life: 2, size0: size, size1: size * 4, c0: [0.1, 0.09, 0.08], c1: [0.28, 0.27, 0.26], alpha: 0.35, drag: 1,
    });
  },
  hurtPlayer(amount, from) {
    if (state !== 'play') return;
    player.hp -= amount;
    player.hurtTimer = 0.4;
    hurtFlash = 1;
    sfx.hurt();
    game.shake = Math.max(game.shake, 0.3);
    if (from) {
      const k = player.position.clone().sub(from).setY(0).normalize().multiplyScalar(6);
      player.velocity.add(k);
    }
    if (player.hp <= 0) die();
  },
  spawnOrb(from) {
    const target = player.chest.add(player.velocity.clone().multiplyScalar(0.25));
    const orb = new Orb(from, target);
    scene.add(orb.mesh);
    game.orbs.push(orb);
    sfx.spirit();
  },
  aimPoint() { return aimPoint(); },
  toast(text) { toast(text); },
};
const bending = new Bending(game);
window.__game = game; // handy for debugging in the console

let state = 'loading';
let element = 'fire';
let yaw = Math.PI * 0.15, pitch = 0.25, camDist = 5.5;
let hurtFlash = 0, healFlash = 0, waveTimer = 0;
const keys = {};
let mouseDown = false, jumpPressed = false;

// ---------- input ----------
const ORDER = ['fire', 'water', 'earth', 'air'];
function setElement(e) {
  element = e;
  document.querySelectorAll('.el').forEach((n) => n.classList.toggle('active', n.dataset.el === e));
  $('el-name').textContent = ELEMENTS[e].name;
}
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { jumpPressed = true; e.preventDefault(); }
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (idx >= 0) setElement(ORDER[idx]);
  if (e.code === 'KeyQ') setElement(ORDER[(ORDER.indexOf(element) + 3) % 4]);
  if (e.code === 'KeyE') setElement(ORDER[(ORDER.indexOf(element) + 1) % 4]);
  if (e.code === 'KeyF' && state === 'play') doSpecial();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  const dir = e.deltaY > 0 ? 1 : 3;
  setElement(ORDER[(ORDER.indexOf(element) + dir) % 4]);
});
addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (state !== 'play' || document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) { mouseDown = true; doPrimary(); }
  if (e.button === 2) doSpecial();
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.0022, -0.45, 1.2);
});
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && state === 'play') { state = 'paused'; show('pause'); }
});
function lock() { renderer.domElement.requestPointerLock?.(); }

$('start-btn').addEventListener('click', () => { sfx.init(); startGame(); });
$('pause').addEventListener('click', () => { state = 'play'; hide('pause'); lock(); });
$('restart-btn').addEventListener('click', () => { startGame(); });

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
let toastTimer;
function toast(text, long) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), long ? 2600 : 1400);
}

function doPrimary() {
  const origin = player.handPosition;
  const aim = aimPoint();
  const aimYaw = Math.atan2(aim.x - player.position.x, aim.z - player.position.z);
  if (bending.primary(element, origin, aim)) player.cast(aimYaw);
}
function doSpecial() {
  if (bending.special(element)) {
    player.cast(player.facing);
    if (element === 'water') healFlash = 1;
  } else if (player.chi < ELEMENTS[element].special) {
    $('chi').parentElement.classList.add('flash');
    setTimeout(() => $('chi').parentElement.classList.remove('flash'), 300);
  }
}

const _ray = new THREE.Vector3();
function aimPoint() {
  const origin = camera.position.clone();
  camera.getWorldDirection(_ray);
  // aim assist: snap to a spirit close to the crosshair ray
  let best = null, bestD = 2.2;
  for (const e of game.enemies) {
    const to = e.position.clone().sub(origin);
    const t = to.dot(_ray);
    if (t < 2 || t > 120) continue;
    const off = to.sub(_ray.clone().multiplyScalar(t)).length();
    if (off < bestD) { bestD = off; best = e; }
  }
  if (best) return best.position.clone();
  const p = new THREE.Vector3();
  for (let t = 3; t < 160; t += 1.5) {
    p.copy(origin).addScaledVector(_ray, t);
    if (p.y < groundAt(p.x, p.z)) return p;
  }
  return origin.addScaledVector(_ray, 160);
}

// ---------- flow ----------
function clearActors() {
  for (const e of game.enemies) scene.remove(e.group);
  for (const o of game.orbs) scene.remove(o.mesh);
  game.enemies.length = 0;
  game.orbs.length = 0;
}

function startGame() {
  clearActors();
  player.position.set(0, 12, 14);
  player.velocity.set(0, 0, 0);
  player.hp = 100; player.chi = 100;
  game.score = 0; game.wave = 0;
  waveTimer = 2.5;
  hide('title'); hide('dead'); hide('pause'); show('hud');
  setElement('fire');
  state = 'play';
  lock();
  toast('Verdedig het heiligdom tegen de schimgeesten', true);
}

function spawnWave() {
  game.wave++;
  const n = 2 + game.wave * 2;
  for (let i = 0; i < n; i++) {
    const s = new Spirit(randomSpawnPoint(player.position), game.wave);
    s.spawnT = -i * 0.4; // staggered arrival
    scene.add(s.group);
    game.enemies.push(s);
  }
  toast(`Golf ${game.wave} — ${n} schimgeesten naderen`, true);
  sfx.spirit();
}

function die() {
  state = 'dead';
  document.exitPointerLock?.();
  $('final-score').textContent = game.score;
  $('final-wave').textContent = game.wave;
  show('dead');
}

// ---------- update ----------
function updatePlay(dt) {
  const input = {
    forward: keys.KeyW || keys.ArrowUp, back: keys.KeyS || keys.ArrowDown,
    left: keys.KeyA || keys.ArrowLeft, right: keys.KeyD || keys.ArrowRight,
    sprint: keys.ShiftLeft || keys.ShiftRight, jump: keys.Space, jumpPressed,
  };
  const wasGround = player.onGround, prevVy = player.velocity.y;
  player.update(dt, input, yaw, element);
  if (!wasGround && player.onGround && prevVy < -14) {
    bending.dust(player.position.clone().setY(player.position.y + 0.1), 16, 3);
    game.shake = Math.max(game.shake, 0.15);
  }
  if (player.gliding && Math.random() < 0.5) {
    mist.emit({ x: player.position.x + (Math.random() - 0.5), y: player.position.y + 0.5, z: player.position.z + (Math.random() - 0.5), vx: 0, vy: 2, vz: 0, life: 0.6, size0: 0.3, size1: 1.4, alpha: 0.2, drag: 1 });
  }
  if (player.swimming && Math.hypot(player.velocity.x, player.velocity.z) > 1 && Math.random() < 0.5) {
    spray.emit({ x: player.position.x, y: 0.05, z: player.position.z, vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random(), vz: (Math.random() - 0.5) * 2, life: 0.6, size0: 0.15, size1: 0.05, c0: [0.85, 0.95, 1], alpha: 0.8, grav: -9 });
  }
  if (mouseDown && element !== 'earth') doPrimary();

  bending.update(dt);

  for (const e of game.enemies) {
    if (e.spawnT < 0) { e.spawnT += dt; continue; }
    e.update(dt, game);
    if (e.hp <= 0 && !e.dead) {
      e.dead = true;
      scene.remove(e.group);
      game.score += 100 * game.wave;
      for (let i = 0; i < 60; i++) smoke.emit({ x: e.position.x, y: e.position.y, z: e.position.z, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, vz: (Math.random() - 0.5) * 8, life: 1.5, size0: 1, size1: 3, c0: [0.03, 0.02, 0.05], c1: [0.2, 0.18, 0.22], alpha: 0.7, drag: 2.5 });
      for (let i = 0; i < 40; i++) sparks.emit({ x: e.position.x, y: e.position.y, z: e.position.z, vx: (Math.random() - 0.5) * 10, vy: Math.random() * 8, vz: (Math.random() - 0.5) * 10, life: 1, size0: 0.12, size1: 0.02, c0: [3, 1.2, 4], c1: [0.6, 0.1, 1.2], drag: 1.5, grav: -4 });
      lights.flash(e.position, 0xb060ff, 120, 20, 0.6);
      sfx.spirit();
    }
  }
  game.enemies = game.enemies.filter((e) => !e.dead);

  for (const o of game.orbs) {
    o.life -= dt;
    o.mesh.position.addScaledVector(o.velocity, dt);
    const p = o.mesh.position;
    if (Math.random() < 0.8) sparks.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), life: 0.5, size0: 0.35, size1: 0.05, c0: [1.4, 0.4, 2.6], alpha: 0.7 });
    if (p.distanceTo(player.chest) < 0.9) { game.hurtPlayer(9, p); o.dead = true; }
    else if (p.y < groundAt(p.x, p.z) || o.life <= 0) o.dead = true;
    if (o.dead) {
      scene.remove(o.mesh);
      for (let i = 0; i < 20; i++) sparks.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 6, life: 0.6, size0: 0.15, size1: 0.02, c0: [2, 0.6, 3.5], grav: -6 });
    }
  }
  game.orbs = game.orbs.filter((o) => !o.dead);

  if (game.enemies.length === 0) {
    waveTimer -= dt;
    if (waveTimer <= 0) { spawnWave(); waveTimer = 5; }
  }
  jumpPressed = false;
}

const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  if (state === 'title' || state === 'loading') {
    const t = game.time * 0.05;
    camera.position.set(Math.sin(t) * 30, 17 + Math.sin(t * 0.7) * 3, Math.cos(t) * 30);
    camera.lookAt(0, 12, 0);
    return;
  }
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const want = player.position.clone().add(new THREE.Vector3(0, 1.75, 0)).addScaledVector(right, 0.65);
  camTarget.lerp(want, Math.min(1, 14 * dt));
  if (camTarget.distanceTo(want) > 5) camTarget.copy(want);
  const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const pos = camTarget.clone().addScaledVector(off, camDist);
  const floor = Math.max(groundAt(pos.x, pos.z), 0) + 0.5;
  if (pos.y < floor) pos.y = floor;
  camera.position.copy(pos);
  camera.lookAt(camTarget);
  if (game.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * game.shake;
    camera.position.y += (Math.random() - 0.5) * game.shake;
    game.shake = Math.max(0, game.shake - dt * 1.2);
  }
}

function updateAmbient(dt) {
  // brazier
  if (shrine) {
    const fp = shrine.firePoint;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.8;
      game.emitFire(new THREE.Vector3(fp.x + Math.cos(a) * r, fp.y - 0.4, fp.z + Math.sin(a) * r), new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6), 0.7, 0.5);
    }
    if (Math.random() < 0.3) sparks.emit({ x: fp.x, y: fp.y, z: fp.z, vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 1.5, life: 2, size0: 0.06, size1: 0.02, c0: [5, 2, 0.5], c1: [1, 0.2, 0], drag: 0.3, grav: 0.5, spin: 0 });
    brazierLight.intensity = 34 + Math.sin(game.time * 13) * 5 + Math.random() * 8;
  }
  // drifting pollen in the light
  for (let i = 0; i < 2; i++) {
    const c = camera.position;
    motes.emit({ x: c.x + (Math.random() - 0.5) * 40, y: c.y + (Math.random() - 0.5) * 10, z: c.z + (Math.random() - 0.5) * 40, vx: 0.4 + Math.random() * 0.3, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.4, life: 6, size0: 0.05, size1: 0.05, c0: [1.6, 1.3, 0.8], alpha: 0.6, spin: 0 });
  }
}

function updateHud() {
  $('hp').style.width = Math.max(0, player.hp) + '%';
  $('chi').style.width = Math.max(0, player.chi) + '%';
  $('score').textContent = game.score;
  $('wave').textContent = game.wave;
  $('foes').textContent = game.enemies.length;
  const cost = ELEMENTS[element];
  $('chi-cost').style.left = (100 - cost.special) + '%';
}

const clock = new THREE.Clock();
let debugHold = false;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!debugHold) tick(dt);
}

function tick(dt, skipRender) {
  game.time += dt;
  wind.value = game.time;
  if (state === 'play') updatePlay(dt);
  else if (state === 'dead' || state === 'paused') player.animate(dt, false, 0);
  updateAmbient(dt);
  updateCamera(dt);

  // shadow frustum follows the action
  const focus = state === 'play' || state === 'paused' || state === 'dead' ? player.position : new THREE.Vector3(0, 9, 0);
  sun.position.copy(focus).addScaledVector(sunDir, 200);
  sun.target.position.copy(focus);

  allParticles.forEach((p) => p.update(dt));
  lights.update(dt);
  if (water) water.material.uniforms.time.value += dt * 0.6;
  if (clouds) clouds.material.uniforms.uTime.value = game.time;

  hurtFlash = Math.max(0, hurtFlash - dt * 2.2);
  healFlash = Math.max(0, healFlash - dt * 1.2);
  const lowHp = state === 'play' && player.hp < 30 ? 0.35 + Math.sin(game.time * 5) * 0.15 : 0;
  grade.uniforms.uHurt.value = Math.max(hurtFlash, lowHp);
  grade.uniforms.uHeal.value = healFlash;
  grade.uniforms.uTime.value = game.time;
  if (state !== 'loading') updateHud();
  if (!skipRender) composer.render();
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  const h = innerHeight * renderer.getPixelRatio();
  allParticles.forEach((p) => p.setViewport(h, camera.fov));
}
addEventListener('resize', resize);

window.__debug = {
  startGame, doPrimary, doSpecial, setElement, spawnWave,
  view(y, p) { yaw = y; pitch = p; },
  // freeze the real-time loop and advance the simulation manually (for slow/headless renderers)
  hold(on) { debugHold = on; },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt, i < n - 1); },
};

(async () => {
  resize();
  await buildWorld();
  setLoad(100, 'Klaar');
  await nextFrame();
  state = 'title';
  hide('loading');
  show('title');
  frame();
})();
