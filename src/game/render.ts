import { State, Item, hookTip, timeLeft, PIVOT_X, PIVOT_Y, WORLD_W, WORLD_H } from './engine';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private logo: HTMLImageElement;
  private earth: CanvasGradient;
  private flashes: { x: number; y: number; text: string; t0: number; color: string }[] = [];

  constructor(canvas: HTMLCanvasElement, logoSrc: string) {
    canvas.width = WORLD_W;
    canvas.height = WORLD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.logo = new Image();
    this.logo.src = logoSrc;
    this.earth = ctx.createLinearGradient(0, 100, 0, WORLD_H);
    this.earth.addColorStop(0, '#b8743c');
    this.earth.addColorStop(0.35, '#9b5a2b');
    this.earth.addColorStop(1, '#5c3417');
  }

  flash(x: number, y: number, text: string, color = '#ffe34d'): void {
    this.flashes.push({ x, y, text, t0: performance.now(), color });
  }

  draw(s: State): void {
    const c = this.ctx;
    c.clearRect(0, 0, WORLD_W, WORLD_H);

    // Earth
    c.fillStyle = this.earth;
    c.fillRect(0, 100, WORLD_W, WORLD_H - 100);
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 2;
    for (const yy of [230, 360, 480]) {
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

    // Miner badge
    c.save();
    c.beginPath();
    c.arc(PIVOT_X, 48, 46, 0, Math.PI * 2);
    c.fillStyle = '#1e4fb0';
    c.fill();
    c.clip();
    if (this.logo.complete && this.logo.naturalWidth > 0) {
      c.drawImage(this.logo, PIVOT_X - 46, 2, 92, 92);
    }
    c.restore();

    // Items
    for (const it of s.items) {
      if (it.gone) continue;
      this.drawItem(it);
    }

    // Rope + hook
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
    c.fillStyle = '#5a3a00';
    c.fillText('Money', 16, 12);
    c.fillText('Goal', 16, 48);
    c.fillStyle = '#1f8a1f';
    c.fillText(`$${s.money}`, 100, 12);
    c.fillStyle = '#7a4a00';
    c.fillText(`$${s.goal}`, 100, 48);
    c.textAlign = 'right';
    c.fillStyle = '#5a3a00';
    c.fillText('Time:', 700, 12);
    c.fillText('Level:', 700, 48);
    const tl = timeLeft(s);
    c.fillStyle = tl <= 10 ? '#d6241f' : '#c25a00';
    c.fillText(String(tl), 770, 12);
    c.fillStyle = '#c25a00';
    c.fillText(String(s.level), 770, 48);
    c.textAlign = 'left';

    // Inventory
    if (s.inv.dynamite > 0) {
      c.font = 'bold 16px "Segoe UI", Arial, sans-serif';
      c.fillStyle = '#5a3a00';
      c.fillText(`Dynamite x${s.inv.dynamite}  (D)`, 500, 68);
    }
    const buffs: string[] = [];
    if (s.inv.strength) buffs.push('STR');
    if (s.inv.rockbook) buffs.push('ROCK x3');
    if (s.inv.polish) buffs.push('GOLD +20%');
    if (buffs.length) {
      c.font = 'bold 14px "Segoe UI", Arial, sans-serif';
      c.fillStyle = '#1e4fb0';
      c.fillText(buffs.join('  '), 180, 72);
    }

    // Floating texts
    const now = performance.now();
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

  private drawItem(it: Item): void {
    const c = this.ctx;
    c.save();
    c.translate(it.x, it.y);
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
      const rr = r * (0.82 + 0.18 * ((i * 7) % 3) / 2);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }
}
