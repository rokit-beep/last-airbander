/** On-screen touch controls: floating move stick (left), drag-to-look (right) and action buttons. */
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const STICK_RADIUS = 55;

export class TouchControls {
  constructor(root, handlers) {
    this.handlers = handlers;
    this.moveX = 0;
    this.moveY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.attackHeld = false;
    this.jumpHeld = false;
    this.jumpPressed = false;
    this.stickId = null;
    this.lookId = null;

    this.stick = document.createElement('div');
    this.stick.className = 'stick hidden';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    root.appendChild(this.stick);

    this.zone = document.createElement('div');
    this.zone.className = 'touch-zone';
    root.appendChild(this.zone);
    this.zone.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    this.zone.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.zone.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    this.zone.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });

    this.bindButton('btn-attack', () => { this.attackHeld = true; handlers.attack(); }, () => { this.attackHeld = false; });
    this.bindButton('btn-special', () => handlers.special());
    this.bindButton('btn-jump', () => { this.jumpHeld = true; this.jumpPressed = true; }, () => { this.jumpHeld = false; });
    this.bindButton('btn-pause', () => handlers.pause());
    document.querySelectorAll('.el').forEach((el) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); handlers.element(el.dataset.el); }, { passive: false });
    });
  }

  bindButton(id, down, up) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.add('pressed');
      down();
    }, { passive: false });
    const release = (e) => {
      e.preventDefault();
      el.classList.remove('pressed');
      up?.();
    };
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  }

  onStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && this.stickId === null) {
        this.stickId = t.identifier;
        this.ox = t.clientX; this.oy = t.clientY;
        this.stick.style.left = t.clientX + 'px';
        this.stick.style.top = t.clientY + 'px';
        this.knob.style.transform = 'translate(-50%, -50%)';
        this.stick.classList.remove('hidden');
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lx = t.clientX; this.ly = t.clientY;
      }
    }
  }

  onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.ox, dy = t.clientY - this.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_RADIUS) { dx *= STICK_RADIUS / d; dy *= STICK_RADIUS / d; }
        this.moveX = dx / STICK_RADIUS;
        this.moveY = -dy / STICK_RADIUS;
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (t.identifier === this.lookId) {
        this.lookDX += t.clientX - this.lx;
        this.lookDY += t.clientY - this.ly;
        this.lx = t.clientX; this.ly = t.clientY;
      }
    }
  }

  onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.moveX = this.moveY = 0;
        this.stick.classList.add('hidden');
      } else if (t.identifier === this.lookId) this.lookId = null;
    }
  }

  /** Returns and clears the accumulated look delta (pixels). */
  consumeLook() {
    const d = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return d;
  }

  reset() {
    this.stickId = this.lookId = null;
    this.moveX = this.moveY = this.lookDX = this.lookDY = 0;
    this.attackHeld = this.jumpHeld = this.jumpPressed = false;
    this.stick.classList.add('hidden');
  }
}
