// WebHID layer: connect to a controller, parse its HID report descriptor into a
// field map (buttons / analog axes / hat), and emit decoded state on every input
// report. Works for any HID gamepad — including licensed Switch Pro clones that
// report VID/PID 0 over Bluetooth and never show up in the Gamepad API.

const PAGE_GENERIC_DESKTOP = 0x01;
const PAGE_BUTTON = 0x09;

// Generic Desktop analog axis usages we care about.
const AXIS_USAGES = {
  0x30: 'lx', // X  — left stick X
  0x31: 'ly', // Y  — left stick Y
  0x32: 'z',  // Z
  0x33: 'rx', // Rx — right stick X
  0x34: 'ry', // Ry — right stick Y
  0x35: 'rz', // Rz
};
const HAT_USAGE = 0x39;

export function readBits(view, bitOffset, size) {
  let v = 0;
  for (let i = 0; i < size; i++) {
    const bit = bitOffset + i, idx = bit >> 3;
    if (idx >= view.byteLength) break;
    v |= ((view.getUint8(idx) >> (bit & 7)) & 1) << i;
  }
  return v >>> 0;
}

// Hat switch: value (0-based from logical min) maps clockwise from "up".
// Anything out of range = centered.
export function decodeHat(raw, lmin, lmax) {
  const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const n = raw - lmin;
  if (raw < lmin || raw > lmax || n < 0 || n > 7) return { x: 0, y: 0 };
  const [x, y] = dirs[n];
  return { x, y };
}

// Decode one analog axis: sign-extend signed fields (negative logicalMinimum)
// then normalize to roughly -1..+1 with center at 0. Pure — unit-tested.
export function decodeAxis(rawUnsigned, size, lmin, lmax) {
  let raw = rawUnsigned;
  if (lmin < 0 && raw >= 2 ** (size - 1)) raw -= 2 ** size;
  const mid = (lmin + lmax) / 2, half = Math.max((lmax - lmin) / 2, 1);
  return { raw, norm: (raw - mid) / half };
}

// WebHID report-item usages are 32-bit (page<<16 | id) in Chromium today; accept
// {usagePage, usage} objects too in case a future engine exposes them that way.
export function splitUsage(u) {
  if (u && typeof u === 'object') return { page: u.usagePage, id: u.usage };
  return { page: (u >>> 16) & 0xffff, id: u & 0xffff };
}

export class ControllerHID extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.fieldsByReport = {};
    this._boundReport = (e) => this._onReport(e);
    if ('hid' in navigator) {
      navigator.hid.addEventListener('disconnect', (ev) => {
        if (ev.device === this.device) this.dispatchEvent(new CustomEvent('hiddisconnect'));
      });
    }
  }

  static supported() { return 'hid' in navigator; }

  async request() {
    // Generic Desktop → Game Pad / Joystick / Multi-axis: hides mice, keyboards
    // and sensors from the picker while still matching Switch Pro clones.
    const devices = await navigator.hid.requestDevice({ filters: [
      { usagePage: 0x01, usage: 0x05 },
      { usagePage: 0x01, usage: 0x04 },
      { usagePage: 0x01, usage: 0x08 },
    ] });
    if (!devices.length) return null;
    await this.use(devices[0]);
    return this.device;
  }

  async use(device) {
    if (this.device && this.device !== device) {
      try { this.device.removeEventListener('inputreport', this._boundReport); } catch {}
    }
    this.device = device;
    if (!device.opened) await device.open();

    this.fieldsByReport = {};
    for (const c of device.collections)
      for (const r of (c.inputReports || [])) {
        const parsed = this._parseReport(r);
        const existing = this.fieldsByReport[r.reportId];
        if (existing) {   // same reportId across collections: merge, don't overwrite
          existing.buttons.push(...parsed.buttons);
          existing.axes.push(...parsed.axes);
          existing.hat = existing.hat || parsed.hat;
        } else {
          this.fieldsByReport[r.reportId] = parsed;
        }
      }

    device.addEventListener('inputreport', this._boundReport);
    this.dispatchEvent(new CustomEvent('connect', { detail: this.info() }));
  }

  info() {
    const d = this.device;
    let buttonCount = 0, axisNames = new Set(), hasHat = false;
    for (const f of Object.values(this.fieldsByReport)) {
      for (const b of f.buttons) buttonCount = Math.max(buttonCount, b.index);  // max index, not count (handles sparse usages)
      f.axes.forEach((a) => axisNames.add(a.name));
      if (f.hat) hasHat = true;
    }
    return {
      productName: d.productName || 'Unknown controller',
      vendorId: d.vendorId, productId: d.productId,
      buttonCount, axes: [...axisNames], hasHat,
    };
  }

  _parseReport(report) {
    let bit = 0;
    const buttons = [], axes = [];
    let hat = null;
    for (const item of report.items || []) {
      const count = item.reportCount || 0, size = item.reportSize || 0;
      let usages = [];
      if (item.usages && item.usages.length) usages = item.usages.slice();
      else if (item.isRange && item.usageMinimum != null && item.usageMaximum != null)
        for (let u = item.usageMinimum; u <= item.usageMaximum; u++) usages.push(u);

      for (let f = 0; f < count; f++) {
        const u = usages.length ? usages[Math.min(f, usages.length - 1)] : null;
        if (u != null) {
          const { page, id } = splitUsage(u);
          if (page === PAGE_BUTTON) buttons.push({ index: id, bit });
          else if (page === PAGE_GENERIC_DESKTOP && AXIS_USAGES[id])
            axes.push({ name: AXIS_USAGES[id], usage: id, bit, size, lmin: item.logicalMinimum, lmax: item.logicalMaximum });
          else if (page === PAGE_GENERIC_DESKTOP && id === HAT_USAGE)
            hat = { bit, size, lmin: item.logicalMinimum, lmax: item.logicalMaximum };
        }
        bit += size;
      }
    }
    return { buttons, axes, hat };
  }

  _onReport(e) {
    const f = this.fieldsByReport[e.reportId];
    if (!f) return;
    // Ignore vendor reports (e.g. Nintendo 0xFF01 IMU/NFC) that carry no
    // recognized button/axis/hat fields — they'd otherwise blank the UI.
    if (!f.buttons.length && !f.axes.length && !f.hat) return;
    const view = e.data;
    const state = { reportId: e.reportId, buttons: {}, axes: {}, hat: { x: 0, y: 0 }, byteLength: view.byteLength, hex: '' };

    for (const b of f.buttons) state.buttons[b.index] = !!readBits(view, b.bit, 1);
    for (const a of f.axes) {
      const { raw, norm } = decodeAxis(readBits(view, a.bit, a.size), a.size, a.lmin, a.lmax);
      state.axes[a.name] = { raw, norm, lmin: a.lmin, lmax: a.lmax };
    }
    if (f.hat) state.hat = decodeHat(readBits(view, f.hat.bit, f.hat.size), f.hat.lmin, f.hat.lmax);

    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    state.hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');

    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }
}
