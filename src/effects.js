import * as THREE from 'three';

const vert = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRot;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRot;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vColor = aColor; vAlpha = aAlpha; vRot = aRot;
  }`;

const frag = /* glsl */`
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRot;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float s = sin(vRot), k = cos(vRot);
    c = mat2(k, -s, s, k) * c + 0.5;
    vec4 t = texture2D(uMap, c);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  }`;

/** Pooled GPU point-sprite particles with per-particle colour/size/alpha over life. */
export class Particles {
  constructor(max, texture, blending = THREE.AdditiveBlending) {
    this.max = max;
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;

    // CPU-side state
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.spin = new Float32Array(max);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 400 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  setViewport(height, fov) {
    this.material.uniforms.uScale.value = height / (2 * Math.tan((fov * Math.PI) / 360));
  }

  emit(o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size0 ?? 0.5; this.s1[i] = o.size1 ?? this.s0[i];
    const c0 = o.c0 || [1, 1, 1], c1 = o.c1 || c0;
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.grav ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 2);
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      // quick fade-in, smooth fade-out
      this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t * t);
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aRot']) this.geo.attributes[k].needsUpdate = true;
  }

  kill(i) {
    const last = --this.count;
    if (i === last) return;
    const copy3 = (arr) => { arr[i * 3] = arr[last * 3]; arr[i * 3 + 1] = arr[last * 3 + 1]; arr[i * 3 + 2] = arr[last * 3 + 2]; };
    const copy1 = (arr) => { arr[i] = arr[last]; };
    [this.pos, this.vel, this.col, this.c0, this.c1].forEach(copy3);
    [this.size, this.alpha, this.rot, this.life, this.maxLife, this.s0, this.s1, this.a0, this.drag, this.grav, this.spin].forEach(copy1);
  }
}

/** Fixed set of point lights reused for flashes and moving projectiles (keeps shader light count constant). */
export class LightPool {
  constructor(scene, n = 8) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 25, 2);
      light.position.set(0, -1000, 0);
      scene.add(light);
      this.items.push({ light, life: 0, dur: 1, peak: 0, held: false });
    }
  }

  /** Short flash that fades out over `dur` seconds. */
  flash(pos, color, peak, distance, dur) {
    const it = this.pick();
    it.light.position.copy(pos);
    it.light.color.set(color);
    it.light.distance = distance;
    it.peak = peak; it.life = it.dur = dur; it.held = false;
    it.light.intensity = peak;
    return it;
  }

  /** Light that stays on until released (for projectiles). */
  hold(color, peak, distance) {
    const it = this.pick();
    it.light.color.set(color);
    it.light.distance = distance;
    it.peak = peak; it.held = true; it.life = 1; it.dur = 1;
    it.light.intensity = peak;
    return it;
  }

  release(it) { it.held = false; it.life = 0; it.light.intensity = 0; }

  pick() {
    let best = this.items[0];
    for (const it of this.items) {
      if (!it.held && it.life <= 0) return it;
      if (!it.held && (best.held || it.life < best.life)) best = it;
    }
    return best;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.held) continue;
      if (it.life > 0) {
        it.life -= dt;
        const t = Math.max(0, it.life / it.dur);
        it.light.intensity = it.peak * t * t;
      } else it.light.intensity = 0;
    }
  }
}
