// Canvas stick visualizer + drift recorder.
//
// StickPad draws one analog stick: center crosshair, deadzone ring, a wander
// trail (fade or persist), a bounding box of where the dot travelled, the live
// dot, and a colour verdict. It also supports a range test (max reach per
// direction) and peak-hold (largest offset seen since the last clear).
// Values are normalized -1..+1 (center 0); Y is flipped so "up on the stick"
// reads as "up on screen".

const FADE_WINDOW_MS = 2500;
const RANGE_BINS = 72; // 5° per bin

// Single source of truth for drift thresholds (normalized 0..1).
// `live` colours the instantaneous dot; `rest` decides the averaged rest-test verdict.
export const DRIFT = {
  live: { clean: 0.06, warn: 0.12 },
  rest: { clean: 0.04, warn: 0.08 },
};

export class StickPad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.trail = [];           // {x, y, t}
    this.mode = 'fade';        // 'fade' | 'persist'
    this.cur = { x: 0, y: 0 };
    this.peak = 0;
    this.rangeBins = new Float32Array(RANGE_BINS);
    this.rangeRecording = false;
    this.showRange = false;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  setMode(m) { this.mode = m; this.trail = []; }
  clear() { this.trail = []; this.peak = 0; }

  setRangeRecording(on) {
    this.rangeRecording = on;
    if (on) { this.rangeBins.fill(0); this.showRange = true; }
  }
  clearRange() { this.rangeBins.fill(0); this.showRange = false; }

  push(x, y) {
    this.cur = { x, y };
    const now = performance.now();
    if (this.rangeRecording) {
      const rad = Math.hypot(x, y), ang = Math.atan2(y, x);
      const bin = ((Math.floor(((ang + Math.PI) / (2 * Math.PI)) * RANGE_BINS)) % RANGE_BINS + RANGE_BINS) % RANGE_BINS;
      if (rad > this.rangeBins[bin]) this.rangeBins[bin] = rad;
    }
    if (this.mode === 'persist') {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.abs(last.x - x) > 0.003 || Math.abs(last.y - y) > 0.003) {
        this.trail.push({ x, y, t: now });
        if (this.trail.length > 60000) this.trail.splice(0, this.trail.length - 60000);
      }
    } else {
      this.trail.push({ x, y, t: now });
      while (this.trail.length && now - this.trail[0].t > FADE_WINDOW_MS) this.trail.shift();
    }
  }

  metrics() {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of this.trail) {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const wander = this.trail.length ? Math.max(maxx - minx, maxy - miny) : 0;
    const offset = Math.hypot(this.cur.x, this.cur.y);
    return { offset, wander, box: { minx, maxx, miny, maxy } };
  }

  rangeStats() {
    const bins = this.rangeBins;
    const touched = [...bins].filter((v) => v > 0.2);
    const maxReach = Math.max(0, ...bins);
    const minReach = touched.length ? Math.min(...touched) : 0;
    const weak = [...bins].filter((v) => v > 0.2 && v < 0.85).length;
    return { coverage: touched.length / RANGE_BINS, maxReach, minReach, weak, touched: touched.length };
  }

  _resize() {
    this._dpr = window.devicePixelRatio || 1;
    this._px = this.canvas.clientWidth || 300;
    this.canvas.width = this._px * this._dpr;
    this.canvas.height = this._px * this._dpr;
    this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._buildBackground();
  }

  // The grid (gradient, rings, spokes, crosshair, deadzone) never changes, so
  // render it once to an offscreen canvas and blit it each frame instead of
  // redrawing ~14 stroke ops + a fresh gradient every frame.
  _buildBackground() {
    const dpr = this._dpr, S = this._px, cx = S / 2, cy = S / 2, r = S / 2 - 6;
    const bg = this._bg || (this._bg = document.createElement('canvas'));
    bg.width = S * dpr; bg.height = S * dpr;
    const c = bg.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = c.createRadialGradient(cx, cy * 0.85, r * 0.1, cx, cy, r * 1.3);
    grad.addColorStop(0, '#171c26'); grad.addColorStop(1, '#0a0c11');
    c.fillStyle = grad; c.fillRect(0, 0, S, S);
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.05)';
    for (const f of [0.25, 0.5, 0.75, 1]) { c.beginPath(); c.arc(cx, cy, r * f, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.04)';
    for (let a = 0; a < 8; a++) { const ang = a * Math.PI / 4; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.10)';
    c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
    c.strokeStyle = 'rgba(70,214,255,.28)';
    c.beginPath(); c.arc(cx, cy, r * 0.08, 0, Math.PI * 2); c.stroke();
  }

  render() {
    const want = this.canvas.clientWidth;
    if (want && Math.abs(want - this._px) > 0.5) this._resize();
    const ctx = this.ctx, S = this._px, cx = S / 2, cy = S / 2, r = S / 2 - 6;
    const toPx = (nx, ny) => [cx + nx * r, cy + ny * r];   // +Y upward on this controller → up-stick = up-screen

    // blit cached background (device resolution, 1:1)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this._bg, 0, 0);
    ctx.restore();

    // range overlay: reached perimeter dots
    if (this.showRange) {
      for (let b = 0; b < RANGE_BINS; b++) {
        const rad = this.rangeBins[b];
        if (rad <= 0) continue;
        const ang = (b / RANGE_BINS) * 2 * Math.PI - Math.PI;
        const [px, py] = toPx(Math.cos(ang) * rad, Math.sin(ang) * rad);
        ctx.fillStyle = rad >= 0.9 ? '#74e08c' : rad >= 0.8 ? '#f2c14e' : '#ff5d7a';
        ctx.beginPath(); ctx.arc(px, py, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // wander trail
    const now = performance.now();
    for (const p of this.trail) {
      const alpha = this.mode === 'persist' ? 0.5 : Math.max(0, 1 - (now - p.t) / FADE_WINDOW_MS) * 0.6;
      if (alpha <= 0) continue;
      const [px, py] = toPx(p.x, p.y);
      ctx.fillStyle = `rgba(70,214,255,${alpha})`;
      ctx.beginPath(); ctx.arc(px, py, 1.7, 0, Math.PI * 2); ctx.fill();
    }

    const m = this.metrics();
    // bounding box (dashed)
    if (this.trail.length) {
      const [ax, ay] = toPx(m.box.minx, m.box.miny);
      const [bx, by] = toPx(m.box.maxx, m.box.maxy);
      ctx.strokeStyle = 'rgba(242,193,78,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    }

    this.peak = Math.max(this.peak, m.offset);
    const color = (m.offset < DRIFT.live.clean && m.wander < DRIFT.live.clean) ? '#74e08c'
                : (m.offset < DRIFT.live.warn) ? '#f2c14e' : '#ff5d7a';

    // current dot: cheap layered halo + core (no shadowBlur)
    const [dx, dy] = toPx(this.cur.x, this.cur.y);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(dx, dy, 13, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(dx, dy, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(dx, dy, 2, 0, Math.PI * 2); ctx.fill();

    return { ...m, color, peak: this.peak };
  }
}

// Records normalized samples for a fixed window and computes per-axis stats.
export class DriftRecorder {
  constructor() { this.recording = false; this.samples = []; }

  start(ms, onDone) {
    this.samples = [];
    this.recording = true;
    this._deadline = performance.now() + ms;
    this._onDone = onDone;
    clearTimeout(this._timer);
    // Fallback: end the test even if the controller stops emitting reports
    // (otherwise the deadline, only checked in add(), would never be reached).
    this._timer = setTimeout(() => this._finish(), ms + 300);
  }

  _finish() {
    if (!this.recording) return;
    this.recording = false;
    clearTimeout(this._timer);
    this._onDone?.(this.report());
  }

  add(axes) {
    if (!this.recording) return;
    this.samples.push({
      lx: axes.lx?.norm ?? 0, ly: axes.ly?.norm ?? 0,
      rx: axes.rx?.norm ?? 0, ry: axes.ry?.norm ?? 0,
    });
    if (performance.now() >= this._deadline) this._finish();
  }

  report() {
    const axisStats = (key) => {
      const v = this.samples.map((s) => s[key]);
      if (!v.length) return null;
      const n = v.length;
      const mean = v.reduce((a, b) => a + b, 0) / n;
      const min = Math.min(...v), max = Math.max(...v);
      const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      const maxAbs = Math.max(...v.map(Math.abs));
      return { mean, min, max, std, jitter: max - min, maxAbs, n };
    };
    const sticks = {
      left: { x: axisStats('lx'), y: axisStats('ly') },
      right: { x: axisStats('rx'), y: axisStats('ry') },
    };
    for (const side of ['left', 'right']) {
      const sx = sticks[side].x, sy = sticks[side].y;
      const offset = Math.hypot(sx?.mean ?? 0, sy?.mean ?? 0);
      const jitter = Math.max(sx?.jitter ?? 0, sy?.jitter ?? 0);
      sticks[side].offset = offset;
      sticks[side].jitter = jitter;
      sticks[side].verdict =
        (offset < DRIFT.rest.clean && jitter < DRIFT.rest.clean) ? 'clean' :
        (offset < DRIFT.rest.warn) ? 'small' : 'drift';
    }
    return { count: this.samples.length, sticks, samples: this.samples };
  }

  toCSV() {
    const head = 'sample,lx,ly,rx,ry';
    const rows = this.samples.map((s, i) => `${i},${s.lx},${s.ly},${s.rx},${s.ry}`);
    return [head, ...rows].join('\n');
  }
}
