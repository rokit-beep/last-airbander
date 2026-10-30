import * as THREE from 'three';
import { groundAt, heightAt, WORLD_RADIUS } from './world.js';

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x07060a, roughness: 0.35, metalness: 0.3, emissive: 0x12051c });
const maskMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.55 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff4a18, emissiveIntensity: 9 });
const orbMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9a3cff, emissiveIntensity: 6 });

const bodyGeo = new THREE.SphereGeometry(0.75, 24, 18);
const tendrilGeo = new THREE.ConeGeometry(0.32, 1.6, 10, 1, true);
const maskGeo = new THREE.SphereGeometry(0.5, 24, 16, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.18, Math.PI * 0.6);
const eyeGeo = new THREE.SphereGeometry(0.065, 10, 8);
const orbGeo = new THREE.SphereGeometry(0.28, 14, 10);

/** Shadow spirits that drift over the island and hurl dark orbs. */
export class Spirit {
  constructor(pos, wave) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMat.clone());
    body.scale.set(1, 1.15, 1);
    body.castShadow = true;
    g.add(body);
    this.tendrils = [];
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(tendrilGeo, body.material);
      const a = (i / 5) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.35, -0.95, Math.sin(a) * 0.35);
      t.rotation.x = Math.PI;
      t.castShadow = true;
      g.add(t);
      this.tendrils.push(t);
    }
    const mask = new THREE.Mesh(maskGeo, maskMat);
    mask.position.set(0, 0.15, 0.42);
    mask.scale.set(1, 1.25, 0.8);
    g.add(mask);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.15 * s, 0.27, 0.8);
      eye.scale.set(1.4, 0.7, 0.5);
      g.add(eye);
    }
    this.group = g;
    this.body = body;
    this.position = pos.clone();
    this.velocity = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.maxHp = 50 * (1 + wave * 0.15);
    this.hp = this.maxHp;
    this.speed = 4.5 + Math.random() * 1.5 + wave * 0.2;
    this.fireCd = 2 + Math.random() * 2;
    this.meleeCd = 0;
    this.phase = Math.random() * 10;
    this.slow = 0;
    this.burn = 0;
    this.flash = 0;
    this.radius = 1.0;
    this.dead = false;
    this.spawnT = 0;
    g.position.copy(pos);
    g.scale.setScalar(0.01);
  }

  get center() { return this.position; }

  damage(amount, knock) {
    this.hp -= amount;
    this.flash = 0.15;
    if (knock) this.knock.add(knock);
  }

  update(dt, game) {
    const p = game.player.position;
    this.phase += dt;
    this.spawnT = Math.min(1, this.spawnT + dt * 1.5);
    const sp = this.speed * (this.slow > 0 ? 0.4 : 1);
    const toP = new THREE.Vector3(p.x - this.position.x, 0, p.z - this.position.z);
    const dist = toP.length();
    toP.normalize();
    // keep a fighting distance and circle around the player
    const side = new THREE.Vector3(-toP.z, 0, toP.x).multiplyScalar(Math.sin(this.phase * 0.5) * 0.7);
    const want = new THREE.Vector3();
    if (dist > 14) want.copy(toP);
    else if (dist < 6) want.copy(toP).multiplyScalar(-0.6);
    want.add(side).normalize().multiplyScalar(sp);
    if (dist < 4) want.copy(toP).multiplyScalar(sp * 1.4); // lunge

    this.velocity.lerp(want, Math.min(1, 2 * dt));
    this.position.addScaledVector(this.velocity, dt);
    this.position.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.max(0, 1 - 3 * dt));

    const floor = Math.max(groundAt(this.position.x, this.position.z), 0) + 2.2 + Math.sin(this.phase * 1.7) * 0.35;
    this.position.y += (floor - this.position.y) * Math.min(1, 2.5 * dt);
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > WORLD_RADIUS) { this.position.x *= WORLD_RADIUS / r; this.position.z *= WORLD_RADIUS / r; }

    this.group.position.copy(this.position);
    this.group.rotation.y = Math.atan2(toP.x, toP.z);
    this.group.rotation.z = Math.sin(this.phase * 1.3) * 0.08;
    this.group.scale.setScalar(this.spawnT);
    this.tendrils.forEach((t, i) => {
      t.rotation.z = Math.sin(this.phase * 3 + i * 1.3) * 0.35;
      t.rotation.x = Math.PI + Math.cos(this.phase * 2.4 + i) * 0.3;
    });

    // smoky trail
    if (Math.random() < 0.7) {
      game.smoke.emit({
        x: this.position.x + (Math.random() - 0.5) * 0.8, y: this.position.y - 0.8, z: this.position.z + (Math.random() - 0.5) * 0.8,
        vx: (Math.random() - 0.5) * 0.6, vy: -0.4 - Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.6,
        life: 1.4, size0: 0.9, size1: 2.2, c0: [0.03, 0.02, 0.05], c1: [0.08, 0.06, 0.1], alpha: 0.55, drag: 0.5,
      });
    }

    // status effects
    if (this.slow > 0) this.slow -= dt;
    if (this.burn > 0) {
      this.burn -= dt;
      this.hp -= 6 * dt;
      if (Math.random() < 0.6) game.emitFire(this.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)), new THREE.Vector3(0, 2, 0), 0.6, 0.6);
    }
    this.flash -= dt;
    this.body.material.emissive.setHex(this.flash > 0 ? 0xff5522 : this.slow > 0 ? 0x0a2c48 : 0x12051c);

    // attacks
    if (this.spawnT >= 1) {
      this.fireCd -= dt;
      this.meleeCd -= dt;
      if (dist < 2.6 && this.meleeCd <= 0) {
        this.meleeCd = 1.3;
        game.hurtPlayer(12, this.position);
      } else if (dist < 45 && this.fireCd <= 0) {
        this.fireCd = 2.2 + Math.random() * 1.8;
        game.spawnOrb(this.position.clone().add(new THREE.Vector3(0, 0.2, 0)));
      }
    }
  }
}

export class Orb {
  constructor(from, target) {
    this.mesh = new THREE.Mesh(orbGeo, orbMat);
    this.mesh.position.copy(from);
    this.velocity = target.clone().sub(from).normalize().multiplyScalar(17);
    this.life = 4;
    this.dead = false;
  }
}

export function randomSpawnPoint(around) {
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 45 + Math.random() * 45;
    const x = around.x + Math.cos(a) * d, z = around.z + Math.sin(a) * d;
    if (Math.hypot(x, z) > WORLD_RADIUS - 10) continue;
    const h = heightAt(x, z);
    if (h < 0.5 || h > 70) continue;
    return new THREE.Vector3(x, Math.max(h, 0) + 2.5, z);
  }
  return new THREE.Vector3(around.x + 30, around.y + 3, around.z);
}
