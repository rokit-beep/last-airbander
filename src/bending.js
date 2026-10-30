import * as THREE from 'three';
import { groundAt, rockGeos, getRockMaterial } from './world.js';

export const ELEMENTS = {
  fire: { name: 'Vuur', cost: 12, special: 40, cd: 0.28 },
  water: { name: 'Water', cost: 12, special: 45, cd: 0.35 },
  earth: { name: 'Aarde', cost: 18, special: 40, cd: 0.8 },
  air: { name: 'Lucht', cost: 9, special: 30, cd: 0.55 },
};

const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0x9fd8e8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.72,
  clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6,
});
const waterGeo = new THREE.SphereGeometry(0.32, 20, 14);
const ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 40);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
const spikeGeo = (() => {
  const g = new THREE.ConeGeometry(0.7, 3.2, 7, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) * (0.85 + Math.random() * 0.3));
    p.setZ(i, p.getZ(i) * (0.85 + Math.random() * 0.3));
  }
  g.computeVertexNormals();
  g.translate(0, 1.6, 0);
  return g;
})();

const rand = (a = 1) => (Math.random() - 0.5) * 2 * a;

export class Bending {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.effects = [];
    this.cooldown = 0;
  }

  primary(element, origin, aimPoint) {
    const g = this.game;
    const cfg = ELEMENTS[element];
    if (this.cooldown > 0 || g.player.chi < cfg.cost) return false;
    g.player.chi -= cfg.cost;
    this.cooldown = cfg.cd;
    const dir = aimPoint.clone().sub(origin).normalize();
    if (element === 'fire') this.fireball(origin, dir);
    else if (element === 'water') this.waterWhip(origin, dir);
    else if (element === 'earth') this.boulder(dir);
    else if (element === 'air') this.airBlast(origin, dir);
    return true;
  }

  special(element) {
    const g = this.game;
    const cfg = ELEMENTS[element];
    if (this.cooldown > 0 || g.player.chi < cfg.special) return false;
    g.player.chi -= cfg.special;
    this.cooldown = 0.9;
    if (element === 'fire') this.fireNova();
    else if (element === 'water') this.healingTide();
    else if (element === 'earth') this.spikes();
    else if (element === 'air') this.airLeap();
    return true;
  }

  // ---------- FIRE ----------
  fireball(origin, dir) {
    const g = this.game;
    const light = g.lights.hold(0xff7a2a, 60, 22);
    this.projectiles.push({
      kind: 'fire', pos: origin.clone(), vel: dir.multiplyScalar(40), life: 2.2, radius: 0.9, damage: 26, light, gravity: 0,
    });
    for (let i = 0; i < 25; i++) g.emitFire(origin, dir.clone().multiplyScalar(8).add(new THREE.Vector3(rand(3), rand(3), rand(3))), 0.4, 0.8);
    g.sfx.fire();
  }

  fireNova() {
    const g = this.game, p = g.player.position;
    const c = p.clone().add(new THREE.Vector3(0, 0.6, 0));
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 10;
      g.emitFire(c, new THREE.Vector3(Math.cos(a) * s, Math.random() * 3, Math.sin(a) * s), 0.9 + Math.random() * 0.6, 0.65);
    }
    g.lights.flash(c, 0xff6a1a, 180, 40, 0.8);
    g.sfx.boom();
    g.shake = Math.max(g.shake, 0.5);
    for (const e of g.enemies) {
      const d = e.position.distanceTo(p);
      if (d < 11) {
        const k = e.position.clone().sub(p).setY(0).normalize().multiplyScalar(18);
        k.y = 8;
        e.damage(34, k);
        e.burn = 3;
      }
    }
  }

  // ---------- WATER ----------
  waterWhip(origin, dir) {
    const g = this.game;
    const segs = [];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(waterGeo, waterMat);
      m.scale.setScalar(1 - i * 0.11);
      m.position.copy(origin);
      g.scene.add(m);
      segs.push(m);
    }
    this.projectiles.push({
      kind: 'water', pos: origin.clone(), vel: dir.multiplyScalar(34), life: 2, radius: 0.9, damage: 18, segs, trail: [], gravity: -2,
    });
    g.sfx.water();
  }

  healingTide() {
    const g = this.game;
    const before = g.player.hp;
    g.player.hp = Math.min(100, g.player.hp + 40);
    this.effects.push({ kind: 'heal', t: 0, dur: 1.4 });
    g.lights.flash(g.player.chest, 0x66c8ff, 120, 18, 1.2);
    g.sfx.heal();
    g.toast(`+${Math.round(g.player.hp - before)} gezondheid`);
  }

  // ---------- EARTH ----------
  boulder(dir) {
    const g = this.game, p = g.player.position;
    const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const start = p.clone().addScaledVector(flat, 1.8);
    start.y = groundAt(start.x, start.z) - 0.9;
    const mesh = new THREE.Mesh(rockGeos[(Math.random() * 3) | 0], getRockMaterial());
    mesh.scale.setScalar(0.62);
    mesh.position.copy(start);
    mesh.castShadow = true;
    g.scene.add(mesh);
    this.projectiles.push({
      kind: 'earth', phase: 'rise', t: 0, pos: start, from: start.clone(), vel: new THREE.Vector3(),
      life: 4, radius: 1.1, damage: 42, mesh, gravity: -9, spin: new THREE.Vector3(rand(6), rand(6), rand(6)),
    });
    this.dust(start.clone().setY(start.y + 0.9), 30, 4);
    g.sfx.earth();
    g.shake = Math.max(g.shake, 0.2);
  }

  spikes() {
    const g = this.game, p = g.player.position;
    const f = g.player.facing;
    const dir = new THREE.Vector3(Math.sin(f), 0, Math.cos(f));
    for (let i = 0; i < 8; i++) {
      const at = p.clone().addScaledVector(dir, 2.5 + i * 2.2).add(new THREE.Vector3(rand(0.4), 0, rand(0.4)));
      at.y = groundAt(at.x, at.z);
      this.effects.push({ kind: 'spike', delay: i * 0.07, t: 0, pos: at, mesh: null, hit: false });
    }
    g.sfx.earth();
    g.shake = Math.max(g.shake, 0.45);
  }

  dust(pos, n, spread) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      g.smoke.emit({
        x: pos.x + rand(0.6), y: pos.y, z: pos.z + rand(0.6),
        vx: rand(spread), vy: Math.random() * spread * 0.6, vz: rand(spread),
        life: 1.2 + Math.random(), size0: 0.8, size1: 3.5, c0: [0.45, 0.38, 0.3], c1: [0.55, 0.5, 0.44], alpha: 0.5, drag: 2.2, grav: 0.5,
      });
      if (i % 2 === 0) g.debris.emit({
        x: pos.x, y: pos.y, z: pos.z, vx: rand(spread * 1.2), vy: 3 + Math.random() * spread * 1.5, vz: rand(spread * 1.2),
        life: 1.2, size0: 0.22, size1: 0.18, c0: [0.25, 0.2, 0.16], alpha: 1, grav: -18, spin: 12,
      });
    }
  }

  // ---------- AIR ----------
  airBlast(origin, dir) {
    const g = this.game;
    for (let i = 0; i < 70; i++) {
      const s = 22 + Math.random() * 14;
      g.mist.emit({
        x: origin.x + rand(0.3), y: origin.y + rand(0.3), z: origin.z + rand(0.3),
        vx: dir.x * s + rand(3), vy: dir.y * s + rand(3), vz: dir.z * s + rand(3),
        life: 0.6 + Math.random() * 0.3, size0: 0.4, size1: 2.6, c0: [0.95, 0.97, 1], alpha: 0.28, drag: 2.5, spin: 8,
      });
    }
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.copy(origin);
      ring.lookAt(origin.clone().add(dir));
      g.scene.add(ring);
      this.effects.push({ kind: 'ring', mesh: ring, dir: dir.clone(), t: -i * 0.06, dur: 0.5 });
    }
    // cone hit: also blows away incoming spirit orbs
    for (const o of g.orbs) {
      const to = o.mesh.position.clone().sub(origin);
      if (to.length() < 22 && to.normalize().dot(dir) > 0.75) o.life = 0;
    }
    for (const e of g.enemies) {
      const to = e.position.clone().sub(origin);
      const d = to.length();
      if (d < 20 && to.normalize().dot(dir) > 0.82) {
        const k = dir.clone().setY(0).normalize().multiplyScalar(30 * (1 - d / 25));
        k.y = 10;
        e.damage(12, k);
      }
    }
    g.sfx.air();
  }

  airLeap() {
    const g = this.game, pl = g.player;
    const f = pl.facing;
    pl.velocity.y = 17;
    pl.velocity.x += Math.sin(f) * 10;
    pl.velocity.z += Math.cos(f) * 10;
    pl.onGround = false;
    const p = pl.position;
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 6, r = 0.6 + i * 0.03;
      g.mist.emit({
        x: p.x + Math.cos(a) * r, y: p.y + i * 0.02, z: p.z + Math.sin(a) * r,
        vx: -Math.sin(a) * 6, vy: 4 + Math.random() * 3, vz: Math.cos(a) * 6,
        life: 0.9, size0: 0.5, size1: 2.2, c0: [1, 1, 1], alpha: 0.3, drag: 1.5, spin: 6,
      });
    }
    // shockwave pushes nearby spirits away
    for (const e of g.enemies) {
      const d = e.position.distanceTo(p);
      if (d < 8) e.damage(10, e.position.clone().sub(p).setY(0).normalize().multiplyScalar(20).setY(6));
    }
    g.sfx.air();
  }

  // ---------- update ----------
  update(dt) {
    const g = this.game;
    this.cooldown -= dt;

    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.kind === 'earth' && pr.phase === 'rise') {
        pr.t += dt;
        const k = Math.min(1, pr.t / 0.32);
        const target = g.player.position.clone().add(new THREE.Vector3(0, 2.1, 0));
        const fwd = new THREE.Vector3(Math.sin(g.player.facing), 0, Math.cos(g.player.facing));
        target.addScaledVector(fwd, 1.6);
        pr.pos.lerpVectors(pr.from, target, 1 - Math.pow(1 - k, 3));
        pr.mesh.position.copy(pr.pos);
        pr.mesh.rotation.y += dt * 3;
        if (k >= 1) {
          pr.phase = 'fly';
          const aim = g.aimPoint();
          pr.vel.copy(aim.sub(pr.pos).normalize().multiplyScalar(32));
          pr.vel.y += 2.5;
        }
        continue;
      }
      pr.vel.y += pr.gravity * dt;
      pr.pos.addScaledVector(pr.vel, dt);

      if (pr.kind === 'fire') {
        pr.light.light.position.copy(pr.pos);
        pr.light.light.intensity = 50 + Math.random() * 20;
        const back = pr.vel.clone().multiplyScalar(-0.06);
        for (let i = 0; i < 9; i++) {
          g.emitFire(pr.pos.clone().add(new THREE.Vector3(rand(0.25), rand(0.25), rand(0.25))), back.clone().add(new THREE.Vector3(rand(1.2), rand(1.2) + 1, rand(1.2))), 0.35 + Math.random() * 0.3, 0.9);
        }
      } else if (pr.kind === 'water') {
        pr.trail.unshift(pr.pos.clone());
        if (pr.trail.length > 30) pr.trail.pop();
        pr.segs.forEach((m, i) => {
          const tp = pr.trail[Math.min(pr.trail.length - 1, i * 2)];
          m.position.copy(tp);
          m.position.y += Math.sin(g.time * 20 + i) * 0.05;
        });
        if (Math.random() < 0.9) g.spray.emit({
          x: pr.pos.x, y: pr.pos.y, z: pr.pos.z, vx: rand(1.5), vy: rand(1.5), vz: rand(1.5),
          life: 0.5, size0: 0.15, size1: 0.05, c0: [0.75, 0.9, 1], alpha: 0.8, grav: -9,
        });
      } else if (pr.kind === 'earth') {
        pr.mesh.position.copy(pr.pos);
        pr.mesh.rotation.x += pr.spin.x * dt;
        pr.mesh.rotation.z += pr.spin.z * dt;
      }

      // collisions
      let hit = null;
      for (const e of g.enemies) {
        if (e.position.distanceTo(pr.pos) < e.radius + pr.radius) { hit = e; break; }
      }
      const ground = groundAt(pr.pos.x, pr.pos.z);
      const hitGround = pr.pos.y < ground + 0.2;
      const hitWater = pr.kind === 'fire' && pr.pos.y < 0 && ground < 0;
      if (hit || hitGround || hitWater || pr.life <= 0) this.impact(pr, hit, hitWater);
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    for (const fx of this.effects) this.updateEffect(fx, dt);
    this.effects = this.effects.filter((f) => !f.done);
  }

  impact(pr, enemy, intoWater) {
    const g = this.game;
    pr.dead = true;
    const at = pr.pos.clone();
    if (pr.kind === 'fire') {
      g.lights.release(pr.light);
      if (intoWater) {
        for (let i = 0; i < 30; i++) g.smoke.emit({ x: at.x, y: 0.2, z: at.z, vx: rand(1.5), vy: 2 + Math.random() * 2, vz: rand(1.5), life: 2, size0: 1, size1: 4, c0: [0.8, 0.8, 0.82], alpha: 0.35, drag: 1 });
        g.sfx.splash();
        return;
      }
      for (let i = 0; i < 90; i++) g.emitFire(at, new THREE.Vector3(rand(7), rand(5) + 3, rand(7)), 0.5 + Math.random() * 0.5, 0.9);
      for (let i = 0; i < 25; i++) g.sparks.emit({ x: at.x, y: at.y, z: at.z, vx: rand(12), vy: Math.random() * 12, vz: rand(12), life: 0.8 + Math.random() * 0.6, size0: 0.08, size1: 0.03, c0: [6, 3, 1], c1: [2, 0.4, 0.05], grav: -14, drag: 0.5 });
      for (let i = 0; i < 18; i++) g.smoke.emit({ x: at.x, y: at.y, z: at.z, vx: rand(2), vy: 2 + Math.random() * 2, vz: rand(2), life: 2.5, size0: 1, size1: 4.5, c0: [0.12, 0.1, 0.09], c1: [0.3, 0.29, 0.28], alpha: 0.5, drag: 1 });
      g.lights.flash(at, 0xff6a20, 250, 30, 0.6);
      g.sfx.boom();
      g.shake = Math.max(g.shake, 0.25 * Math.max(0, 1 - at.distanceTo(g.player.position) / 40));
      for (const e of g.enemies) {
        const d = e.position.distanceTo(at);
        if (e === enemy) { e.damage(pr.damage, pr.vel.clone().setY(0).normalize().multiplyScalar(8)); e.burn = 2.5; }
        else if (d < 4) e.damage(10, null);
      }
    } else if (pr.kind === 'water') {
      pr.segs.forEach((m) => g.scene.remove(m));
      for (let i = 0; i < 60; i++) g.spray.emit({ x: at.x, y: at.y, z: at.z, vx: rand(5), vy: Math.random() * 6, vz: rand(5), life: 0.9, size0: 0.18, size1: 0.06, c0: [0.75, 0.9, 1], alpha: 0.9, grav: -14 });
      for (let i = 0; i < 12; i++) g.mist.emit({ x: at.x, y: at.y, z: at.z, vx: rand(2), vy: rand(2), vz: rand(2), life: 0.8, size0: 0.5, size1: 2.2, c0: [0.8, 0.92, 1], alpha: 0.25, drag: 2 });
      g.sfx.splash();
      if (enemy) { enemy.damage(pr.damage, pr.vel.clone().setY(0).normalize().multiplyScalar(10)); enemy.slow = 3; enemy.burn = 0; }
    } else if (pr.kind === 'earth') {
      g.scene.remove(pr.mesh);
      this.dust(at, 40, 6);
      g.sfx.earth();
      g.shake = Math.max(g.shake, 0.35 * Math.max(0, 1 - at.distanceTo(g.player.position) / 40));
      for (const e of g.enemies) {
        const d = e.position.distanceTo(at);
        if (e === enemy) e.damage(pr.damage, pr.vel.clone().setY(0).normalize().multiplyScalar(16).setY(5));
        else if (d < 3.5) e.damage(14, e.position.clone().sub(at).setY(0).normalize().multiplyScalar(8));
      }
    }
    if (enemy) g.sfx.hit();
  }

  updateEffect(fx, dt) {
    const g = this.game;
    if (fx.kind === 'ring') {
      fx.t += dt;
      if (fx.t < 0) { fx.mesh.visible = false; return; }
      fx.mesh.visible = true;
      const k = fx.t / fx.dur;
      fx.mesh.position.addScaledVector(fx.dir, dt * 30);
      fx.mesh.scale.setScalar(0.3 + k * 2.8);
      fx.mesh.material.opacity = 0.3 * (1 - k);
      if (k >= 1) { g.scene.remove(fx.mesh); fx.done = true; }
    } else if (fx.kind === 'heal') {
      fx.t += dt;
      const p = g.player.position;
      for (let i = 0; i < 6; i++) {
        const a = fx.t * 9 + i * (Math.PI / 3), r = 1.1 - fx.t * 0.3;
        g.spray.emit({ x: p.x + Math.cos(a) * r, y: p.y + fx.t * 1.6 + Math.random() * 0.3, z: p.z + Math.sin(a) * r, vx: 0, vy: 0.6, vz: 0, life: 0.6, size0: 0.2, size1: 0.08, c0: [0.6, 0.85, 1], alpha: 0.9 });
        g.sparks.emit({ x: p.x + Math.cos(a) * r, y: p.y + fx.t * 1.6, z: p.z + Math.sin(a) * r, vx: 0, vy: 1, vz: 0, life: 0.5, size0: 0.12, size1: 0.02, c0: [0.6, 1.6, 2.6] });
      }
      if (fx.t > fx.dur) fx.done = true;
    } else if (fx.kind === 'spike') {
      fx.delay -= dt;
      if (fx.delay > 0) return;
      if (!fx.mesh) {
        fx.mesh = new THREE.Mesh(spikeGeo, getRockMaterial());
        fx.mesh.position.copy(fx.pos).setY(fx.pos.y - 0.4);
        fx.mesh.rotation.set(rand(0.25), Math.random() * 6, rand(0.25));
        fx.mesh.castShadow = true;
        fx.mesh.scale.set(1, 0.01, 1);
        g.scene.add(fx.mesh);
        this.dust(fx.pos.clone().setY(fx.pos.y + 0.3), 14, 3);
      }
      fx.t += dt;
      const up = Math.min(1, fx.t / 0.12);
      const down = fx.t > 1.6 ? Math.max(0, 1 - (fx.t - 1.6) / 0.5) : 1;
      fx.mesh.scale.y = Math.max(0.01, up * down);
      if (!fx.hit && up >= 1) {
        fx.hit = true;
        for (const e of g.enemies) {
          const d = Math.hypot(e.position.x - fx.pos.x, e.position.z - fx.pos.z);
          if (d < 2.4) e.damage(36, new THREE.Vector3(rand(3), 14, rand(3)));
        }
      }
      if (fx.t > 2.1) { g.scene.remove(fx.mesh); fx.done = true; }
    }
  }
}
