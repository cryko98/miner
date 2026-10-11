import { State, Item, hookTip, timeLeft, PIVOT_X, PIVOT_Y, WORLD_W, WORLD_H, TICK_RATE } from './engine';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private earth: CanvasGradient;
  private flashes: { x: number; y: number; text: string; t0: number; color: string }[] = [];
  private particles: { x: number; y: number; vx: number; vy: number; t0: number; color: string; size: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = WORLD_W;
    canvas.height = WORLD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.earth = ctx.createLinearGradient(0, 100, 0, WORLD_H);
    this.earth.addColorStop(0, '#b8743c');
    this.earth.addColorStop(0.35, '#9b5a2b');
    this.earth.addColorStop(1, '#5c3417');
  }

  flash(x: number, y: number, text: string, color = '#ffe34d'): void {
    this.flashes.push({ x, y, text, t0: performance.now(), color });
  }

  /** Visual-only particle burst (never touches the simulation). */
  burst(x: number, y: number, color: string, count = 18): void {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 80 + Math.random() * 180;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, t0: now, color, size: 3 + Math.random() * 4 });
    }
  }

  draw(s: State): void {
    const c = this.ctx;
    c.clearRect(0, 0, WORLD_W, WORLD_H);

    // Earth with wavy strata
    c.fillStyle = this.earth;
    c.fillRect(0, 100, WORLD_W, WORLD_H - 100);
    c.strokeStyle = 'rgba(0,0,0,0.14)';
    c.lineWidth = 2;
    for (const yy of [235, 365, 485]) {
      c.beginPath();
      c.moveTo(0, yy);
      for (let x = 0; x <= WORLD_W; x += 40) c.lineTo(x, yy + Math.sin((x + yy) * 0.02) * 10);
      c.stroke();
    }

    // Top bar
    c.fillStyle = '#f5b72d';
    c.fillRect(0, 0, WORLD_W, 100);
    c.fillStyle = '#d9931a';
    c.fillRect(0, 96, WORLD_W, 4);

    this.drawMiner(s);

    // Items
    for (const it of s.items) {
      if (it.gone) continue;
      this.drawItem(it, s.tick);
    }

    // Rope + claw
    const tip = hookTip(s.hook);
    c.strokeStyle = '#2b2b2b';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(PIVOT_X, PIVOT_Y);
    c.lineTo(tip.x, tip.y);
    c.stroke();
    c.save();
    c.translate(tip.x, tip.y);
    c.rotate(-s.hook.angle);
    c.strokeStyle = '#3a3a3a';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-12, 0);
    c.lineTo(-12, 10);
    c.lineTo(0, 16);
    c.lineTo(12, 10);
    c.lineTo(12, 0);
    c.stroke();
    c.fillStyle = '#555';
    c.beginPath();
    c.arc(0, 0, 5, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // HUD
    c.font = 'bold 22px "Segoe UI", Arial, sans-serif';
    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillStyle = '#5a3a00';
    c.fillText('Points', 16, 12);
    c.fillText('Shots', 16, 48);
    c.fillStyle = '#1f8a1f';
    c.fillText(String(s.money), 100, 12);
    c.fillStyle = s.shots <= 5 ? '#d6241f' : '#7a4a00';
    c.fillText(String(s.shots), 100, 48);
    c.textAlign = 'right';
    c.fillStyle = '#5a3a00';
    c.fillText('Time:', 700, 12);
    c.fillText('Dynamite:', 700, 48);
    const tl = timeLeft(s);
    c.fillStyle = tl <= 10 ? '#d6241f' : '#c25a00';
    c.fillText(String(tl), 770, 12);
    c.fillStyle = s.dynamite > 0 ? '#c25a00' : '#9a8a70';
    c.fillText(`${s.dynamite}`, 770, 48);
    c.textAlign = 'left';

    // Particles (pixel squares, gravity, fade)
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.t0 < 700);
    for (const p of this.particles) {
      const t = (now - p.t0) / 1000;
      const px = p.x + p.vx * t;
      const py = p.y + p.vy * t + 300 * t * t;
      c.globalAlpha = 1 - t / 0.7;
      c.fillStyle = p.color;
      c.fillRect(Math.round(px), Math.round(py), p.size, p.size);
    }
    c.globalAlpha = 1;

    // Floating texts
    this.flashes = this.flashes.filter((f) => now - f.t0 < 900);
    for (const f of this.flashes) {
      const k = (now - f.t0) / 900;
      c.globalAlpha = 1 - k;
      c.font = 'bold 24px "Segoe UI", Arial, sans-serif';
      c.fillStyle = f.color;
      c.strokeStyle = '#000';
      c.lineWidth = 3;
      c.strokeText(f.text, f.x, f.y - k * 40);
      c.fillText(f.text, f.x, f.y - k * 40);
      c.globalAlpha = 1;
    }
  }

  /** The old miner sitting at the winch, drawn with primitives so no asset is needed. */
  private drawMiner(s: State): void {
    const c = this.ctx;
    const cx = PIVOT_X;
    const reeling = s.hook.phase === 'in';
    const crank = reeling ? (s.tick * 0.35) % (Math.PI * 2) : 0;

    c.save();
    // Blue badge background like the original
    c.beginPath();
    c.arc(cx, 48, 48, 0, Math.PI * 2);
    c.fillStyle = '#1e4fb0';
    c.fill();
    c.clip();

    // Body (orange shirt)
    c.fillStyle = '#f08a2a';
    c.beginPath();
    c.ellipse(cx - 8, 92, 30, 26, 0, Math.PI, Math.PI * 2);
    c.fill();
    // Suspender
    c.strokeStyle = '#5a2d0c';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(cx - 18, 70);
    c.lineTo(cx - 14, 96);
    c.stroke();

    // Arm reaching to the crank
    c.strokeStyle = '#f08a2a';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(cx + 6, 78);
    c.lineTo(cx + 26, 84 + Math.sin(crank) * 4);
    c.stroke();
    c.fillStyle = '#f7c9a0';
    c.beginPath();
    c.arc(cx + 28, 84 + Math.sin(crank) * 4, 5, 0, Math.PI * 2);
    c.fill();

    // Head
    c.fillStyle = '#f7c9a0';
    c.beginPath();
    c.arc(cx - 8, 52, 18, 0, Math.PI * 2);
    c.fill();
    // Beard
    c.fillStyle = '#f2f2f2';
    c.beginPath();
    c.moveTo(cx - 26, 54);
    c.quadraticCurveTo(cx - 26, 84, cx - 8, 82);
    c.quadraticCurveTo(cx + 10, 84, cx + 10, 54);
    c.quadraticCurveTo(cx - 8, 64, cx - 26, 54);
    c.fill();
    // Mouth
    c.fillStyle = '#b3261e';
    c.beginPath();
    c.ellipse(cx - 8, 64, 6, 4, 0, 0, Math.PI);
    c.fill();
    // Moustache
    c.fillStyle = '#f2f2f2';
    c.beginPath();
    c.ellipse(cx - 8, 61, 10, 3.5, 0, 0, Math.PI * 2);
    c.fill();
    // Nose
    c.fillStyle = '#f0a070';
    c.beginPath();
    c.arc(cx - 8, 56, 4, 0, Math.PI * 2);
    c.fill();
    // Eyes
    c.fillStyle = '#fff';
    c.beginPath();
    c.ellipse(cx - 14, 49, 4, 4.5, 0, 0, Math.PI * 2);
    c.ellipse(cx - 2, 49, 4, 4.5, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1b3a8a';
    c.beginPath();
    c.arc(cx - 13, 50, 2, 0, Math.PI * 2);
    c.arc(cx - 1, 50, 2, 0, Math.PI * 2);
    c.fill();
    // Eyebrows
    c.strokeStyle = '#ddd';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - 18, 43);
    c.lineTo(cx - 10, 42);
    c.moveTo(cx - 6, 42);
    c.lineTo(cx + 2, 43);
    c.stroke();
    // Hat
    c.fillStyle = '#6b3b12';
    c.beginPath();
    c.ellipse(cx - 8, 40, 26, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8a4b17';
    c.beginPath();
    c.moveTo(cx - 24, 40);
    c.quadraticCurveTo(cx - 22, 18, cx - 8, 18);
    c.quadraticCurveTo(cx + 6, 18, cx + 8, 40);
    c.closePath();
    c.fill();
    c.fillStyle = '#4a2708';
    c.fillRect(cx - 24, 34, 32, 4);

    // Winch: drum + crank handle
    c.fillStyle = '#3a3a3a';
    c.beginPath();
    c.arc(cx + 30, 92, 10, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#777';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx + 30, 92, 6, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#222';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx + 30, 92);
    c.lineTo(cx + 30 + Math.cos(crank) * 12, 92 + Math.sin(crank) * 12);
    c.stroke();
    c.restore();

    // Badge rim
    c.strokeStyle = '#163d8a';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, 48, 48, 0, Math.PI * 2);
    c.stroke();
  }

  private drawItem(it: Item, tick: number): void {
    const c = this.ctx;
    c.save();
    c.translate(it.x, it.y);
    // Pop-in: scale from 0 → 1 over 20 ticks with a little overshoot.
    const age = tick - it.born;
    if (age < 20) {
      const k = age / 20;
      const sc = 1.15 - 0.15 * k;
      c.scale(Math.min(1, k * 1.4) * sc, Math.min(1, k * 1.4) * sc);
    }
    if (it.kind === 'gold') {
      c.fillStyle = '#f7c21b';
      c.strokeStyle = '#b8860b';
      c.lineWidth = 2;
      this.nugget(it.r);
      c.fill();
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.beginPath();
      c.ellipse(-it.r * 0.3, -it.r * 0.35, it.r * 0.3, it.r * 0.18, -0.5, 0, Math.PI * 2);
      c.fill();
      // Sparkle on fresh gold
      if (age < TICK_RATE) {
        c.strokeStyle = 'rgba(255,255,255,0.8)';
        c.lineWidth = 2;
        const sp = it.r * 1.2;
        c.beginPath();
        c.moveTo(sp, -sp);
        c.lineTo(sp, -sp - 8);
        c.moveTo(sp - 4, -sp - 4);
        c.lineTo(sp + 4, -sp - 4);
        c.stroke();
      }
    } else if (it.kind === 'rock') {
      c.fillStyle = '#8d8f94';
      c.strokeStyle = '#4e5054';
      c.lineWidth = 2;
      this.nugget(it.r, 7);
      c.fill();
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.beginPath();
      c.ellipse(-it.r * 0.3, -it.r * 0.3, it.r * 0.3, it.r * 0.15, -0.4, 0, Math.PI * 2);
      c.fill();
    } else if (it.kind === 'diamond') {
      c.fillStyle = '#9ff3ff';
      c.strokeStyle = '#2aa9c2';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-it.r, -it.r * 0.3);
      c.lineTo(-it.r * 0.5, -it.r);
      c.lineTo(it.r * 0.5, -it.r);
      c.lineTo(it.r, -it.r * 0.3);
      c.lineTo(0, it.r);
      c.closePath();
      c.fill();
      c.stroke();
    } else {
      c.fillStyle = '#e9d5a8';
      c.strokeStyle = '#8a6b3a';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-it.r * 0.6, -it.r * 0.6);
      c.quadraticCurveTo(-it.r * 1.1, it.r * 0.6, 0, it.r);
      c.quadraticCurveTo(it.r * 1.1, it.r * 0.6, it.r * 0.6, -it.r * 0.6);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = '#c0392b';
      c.font = `bold ${Math.round(it.r * 1.2)}px Arial`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('?', 0, it.r * 0.2);
    }
    c.restore();
  }

  private nugget(r: number, n = 8): void {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.82 + (0.18 * ((i * 7) % 3)) / 2);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }
}
