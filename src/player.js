import * as THREE from 'three';
import { groundAt, WORLD_RADIUS } from './world.js';

const srgb = (hex) => new THREE.Color(hex);

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  m.castShadow = true;
  return m;
}

/** The wanderer: a monk-like bender in layered robes. */
function buildModel() {
  const root = new THREE.Group();
  const cloth = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: srgb(c), roughness: r, metalness: 0 });
  const robe = cloth(0x6b2a1c);
  const robeLight = cloth(0x8f5a2c);
  const trim = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.45, metalness: 0.6 });
  const pants = cloth(0x2d2622);
  const skin = new THREE.MeshStandardMaterial({ color: srgb(0xb98466), roughness: 0.6 });
  const hair = cloth(0x15110e, 0.7);

  // legs
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(0.11 * side, 0.92, 0);
    const leg = capsule(0.085, 0.62, pants);
    leg.position.y = -0.42;
    hip.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), cloth(0x3a2a1e, 0.9));
    foot.position.set(0, -0.82, 0.05);
    foot.castShadow = true;
    hip.add(foot);
    root.add(hip);
    legs.push(hip);
  }

  // flared robe skirt
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push(new THREE.Vector2(0.34 - t * 0.14 + Math.sin(t * 9) * 0.004, 0.42 + t * 0.62));
  }
  const skirt = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), robe);
  skirt.material.side = THREE.DoubleSide;
  skirt.castShadow = true;
  root.add(skirt);

  const torso = capsule(0.2, 0.42, robe);
  torso.position.y = 1.34;
  torso.scale.set(1.1, 1, 0.75);
  root.add(torso);
  // diagonal over-robe sash
  const drape = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.045, 8, 24), robeLight);
  drape.position.set(0, 1.36, 0);
  drape.rotation.set(Math.PI / 2, 0.55, 0);
  drape.scale.set(1.1, 0.8, 1);
  drape.castShadow = true;
  root.add(drape);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.035, 8, 28), trim);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.05;
  belt.scale.set(1.08, 0.78, 1);
  root.add(belt);

  // head
  const neck = capsule(0.055, 0.08, skin);
  neck.position.y = 1.63;
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), skin);
  head.position.y = 1.76;
  head.scale.set(0.92, 1.08, 1);
  head.castShadow = true;
  root.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairCap.position.set(0, 1.775, -0.008);
  hairCap.rotation.x = -0.25;
  hairCap.scale.set(0.95, 1.08, 1.05);
  root.add(hairCap);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), hair);
  bun.position.set(0, 1.86, -0.1);
  root.add(bun);

  // arms with elbows
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.25 * side, 1.5, 0);
    const upper = capsule(0.062, 0.22, robe);
    upper.position.y = -0.15;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.24, 12), robeLight);
    sleeve.position.y = -0.12;
    sleeve.castShadow = true;
    elbow.add(sleeve);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), skin);
    hand.position.y = -0.28;
    hand.scale.set(0.9, 1.2, 0.7);
    elbow.add(hand);
    shoulder.add(elbow);
    root.add(shoulder);
    arms.push({ shoulder, elbow, hand });
  }
  return { root, legs, arms, torso, skirt };
}

export class Player {
  constructor() {
    this.model = buildModel();
    this.group = this.model.root;
    this.position = new THREE.Vector3(0, 12, 14);
    this.velocity = new THREE.Vector3();
    this.facing = Math.PI;
    this.onGround = false;
    this.swimming = false;
    this.gliding = false;
    this.hp = 100;
    this.chi = 100;
    this.castTimer = 0;
    this.castSide = 1;
    this.walkPhase = 0;
    this.hurtTimer = 0;
    this.colliders = [];
  }

  get handPosition() {
    const hand = this.model.arms[this.castSide > 0 ? 1 : 0].hand;
    return hand.getWorldPosition(new THREE.Vector3());
  }

  get chest() { return this.position.clone().add(new THREE.Vector3(0, 1.35, 0)); }

  cast(aimYaw) {
    this.castTimer = 0.35;
    this.castSide *= -1;
    this.facing = aimYaw;
  }

  update(dt, input, camYaw, element) {
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = new THREE.Vector3();
    if (input.forward) wish.add(fwd);
    if (input.back) wish.sub(fwd);
    if (input.right) wish.add(right);
    if (input.left) wish.sub(right);
    // analog stick (touch): magnitude scales speed, full deflection sprints
    let analog = 1;
    if (input.axisX || input.axisY) {
      wish.addScaledVector(right, input.axisX).addScaledVector(fwd, input.axisY);
      analog = Math.min(1, Math.hypot(input.axisX, input.axisY));
    }
    const moving = wish.lengthSq() > 0.01;
    if (moving) wish.normalize();

    const ground = groundAt(this.position.x, this.position.z);
    this.swimming = ground < -1.2 && this.position.y < 0.2;
    let speed = input.sprint || analog > 0.95 ? 10.5 : 6 * Math.min(1, analog / 0.8);
    if (this.swimming) speed = 3.8 * Math.min(1, analog / 0.8);
    if (!this.onGround && !this.swimming) speed *= 0.9;

    const accel = this.onGround || this.swimming ? 12 : 3.5;
    const target = wish.multiplyScalar(speed);
    this.velocity.x += (target.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (target.z - this.velocity.z) * Math.min(1, accel * dt);

    if (moving && this.castTimer <= 0) {
      const want = Math.atan2(target.x, target.z);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, 12 * dt);
    }

    // vertical
    this.gliding = false;
    if (this.swimming) {
      this.velocity.y += (-0.9 - this.position.y) * 4 * dt - this.velocity.y * 3 * dt;
      if (input.jump) this.velocity.y = 6;
    } else {
      this.velocity.y -= 24 * dt;
      if (this.onGround && input.jumpPressed) { this.velocity.y = 9; this.onGround = false; }
      if (!this.onGround && input.jump && element === 'air' && this.velocity.y < -2) {
        this.velocity.y = -2.2; // glide on the wind
        this.gliding = true;
      }
    }

    this.position.addScaledVector(this.velocity, dt);

    // simple circle colliders (columns, trees)
    for (const c of this.colliders) {
      const dx = this.position.x - c.x, dz = this.position.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + 0.35;
      if (d < min && d > 0.0001 && this.position.y < groundAt(c.x, c.z) + 8) {
        this.position.x = c.x + (dx / d) * min;
        this.position.z = c.z + (dz / d) * min;
      }
    }
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > WORLD_RADIUS) {
      this.position.x *= WORLD_RADIUS / r;
      this.position.z *= WORLD_RADIUS / r;
    }

    const g = groundAt(this.position.x, this.position.z);
    if (this.position.y <= g) {
      // step-up limit: avoid teleporting up cliffs
      this.position.y = g;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
    } else this.onGround = this.position.y - g < 0.05;

    this.animate(dt, moving, speed);
    this.chi = Math.min(100, this.chi + 13 * dt);
    this.castTimer -= dt;
    this.hurtTimer -= dt;
  }

  animate(dt, moving, speed) {
    const m = this.model;
    const hspeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkPhase += dt * hspeed * 1.5;
    const amp = Math.min(1, hspeed / 7) * (this.onGround ? 0.75 : 0.2);
    const s = Math.sin(this.walkPhase);
    m.legs[0].rotation.x = s * amp;
    m.legs[1].rotation.x = -s * amp;
    const bob = this.onGround ? Math.abs(Math.cos(this.walkPhase)) * 0.05 * amp : 0;

    for (let i = 0; i < 2; i++) {
      const arm = m.arms[i];
      const side = i === 0 ? -1 : 1;
      let rx = (i === 0 ? s : -s) * amp * 0.8;
      let rz = side * 0.12;
      let ex = -0.25;
      if (this.gliding) { rx = 0; rz = side * 1.4; ex = 0; }
      if (this.swimming) { rx = Math.sin(this.walkPhase * 0.7 + i * Math.PI) * 1.2 - 1.2; ex = -0.4; }
      if (this.castTimer > 0) {
        const t = this.castTimer / 0.35;
        const active = side === this.castSide;
        const k = Math.sin(t * Math.PI);
        if (active) { rx = -1.55 * Math.min(1, t * 2.5); ex = -0.1; rz = side * 0.15; }
        else { rx = -0.6 * k; ex = -1.4 * k; }
      }
      arm.shoulder.rotation.x += (rx - arm.shoulder.rotation.x) * Math.min(1, 18 * dt);
      arm.shoulder.rotation.z += (rz - arm.shoulder.rotation.z) * Math.min(1, 18 * dt);
      arm.elbow.rotation.x += (ex - arm.elbow.rotation.x) * Math.min(1, 18 * dt);
    }
    m.skirt.rotation.x = -Math.min(0.25, hspeed * 0.025);
    this.group.position.copy(this.position);
    this.group.position.y += bob + (this.swimming ? 0.25 : 0);
    this.group.rotation.y = this.facing;
    this.group.rotation.x = this.swimming ? 1.1 : 0;
  }
}
