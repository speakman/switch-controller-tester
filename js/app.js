import { ControllerHID } from './hid.js';
import { StickPad, DriftRecorder } from './sticks.js';
import { ButtonsPanel } from './buttons.js';
import { t, applyStatic, getLang, setLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const hid = new ControllerHID();
const leftPad = new StickPad($('leftCanvas'));
const rightPad = new StickPad($('rightCanvas'));
const recorder = new DriftRecorder();
const buttons = new ButtonsPanel($('buttons-body'));

let latest = { lx: { norm: 0 }, ly: { norm: 0 }, rx: { norm: 0 }, ry: { norm: 0 } };
let connected = false;
let reportTimes = [];
let deviceInfo = null;
let lastRawT = 0, lastStatT = 0;

applyStatic();

// ---------- support gate ----------
function renderSupport() {
  const el = $('support');
  const usable = ControllerHID.supported() && window.isSecureContext;
  document.body.classList.toggle('unsupported', !usable);   // drives view gating
  if (!ControllerHID.supported()) {
    el.innerHTML =
      `<strong class="sup-title">⚠️ ${t('ns_title')}</strong>` +
      `<p>${t('ns_body')}</p>` +
      `<p class="sup-ok">✓ ${t('ns_works')}</p>` +
      `<p class="sup-no">✗ ${t('ns_no')}</p>`;
  } else if (!window.isSecureContext) {
    el.innerHTML = `<strong class="sup-title">⚠️ ${t('ns_secure')}</strong>`;
  } else {
    el.innerHTML = '';
  }
  $('connect').disabled = !usable;
}
renderSupport();

// ---------- connection status rendering ----------
function setLed(state) {
  const led = $('conn-led');
  led.classList.toggle('on', state === 'on');
  led.querySelector('.led-text').textContent =
    state === 'on' ? t('led_on') : state === 'lost' ? t('led_lost') : t('led_off');
}

function renderDevInfo() {
  const el = $('devinfo');
  if (!connected || !deviceInfo) { el.textContent = t('no_device'); return; }
  const i = deviceInfo;
  el.textContent = '';
  const dot = document.createElement('span'); dot.className = 'ok'; dot.textContent = '●';
  // device-supplied productName via textContent (never innerHTML) — avoids HID-string injection
  const name = document.createTextNode(` ${i.productName} `);
  const meta = document.createElement('span'); meta.className = 'dim';
  meta.textContent = `(VID 0x${i.vendorId.toString(16)} · PID 0x${i.productId.toString(16)} · ` +
    `${i.buttonCount} ${t('dev_buttons')} · ${t('dev_axes')}: ${i.axes.join(', ') || '—'}` +
    `${i.hasHat ? t('dev_dpad') : ''})`;
  el.append(dot, name, meta);
}

// ---------- connection ----------
$('connect').addEventListener('click', async () => {
  try { await hid.request(); }
  catch (e) {
    if (e && (e.name === 'NotFoundError' || e.name === 'AbortError')) return; // user dismissed the picker
    $('devinfo').textContent = `${t('connect_error')}: ${e.message}`;
  }
});

hid.addEventListener('connect', (e) => {
  deviceInfo = e.detail;
  connected = true;
  renderDevInfo();
  buttons.build(deviceInfo);
  document.body.classList.add('connected');
  setLed('on');
  updateBugLink();
});

hid.addEventListener('hiddisconnect', () => {
  connected = false;
  deviceInfo = null;
  document.body.classList.remove('connected');
  setLed('lost');
  $('devinfo').textContent = t('led_lost');
  updateBugLink();
});

hid.addEventListener('state', (e) => {
  const s = e.detail;
  latest = s.axes;
  buttons.update(s);
  recorder.add(s.axes);

  const now = performance.now();
  reportTimes.push(now);
  while (reportTimes.length && now - reportTimes[0] > 1000) reportTimes.shift();
  if (now - lastRawT > 100) {   // throttle DOM text; the dot still renders at 60fps
    $('report-hz').textContent = `${reportTimes.length} Hz`;
    $('raw-hex').textContent = `reportId ${s.reportId} · ${s.byteLength} byte · ${s.hex}`;
    lastRawT = now;
  }
});

// ---------- render loop ----------
function frame() {
  if (connected) {
    leftPad.push(latest.lx?.norm ?? 0, latest.ly?.norm ?? 0);
    rightPad.push(latest.rx?.norm ?? 0, latest.ry?.norm ?? 0);
    const lm = leftPad.render();
    const rm = rightPad.render();
    const now = performance.now();
    if (now - lastStatT > 80) {   // numeric readouts ~12 Hz; visualization stays 60 fps
      $('leftStat').innerHTML = statLine(latest.lx, latest.ly, lm);
      $('rightStat').innerHTML = statLine(latest.rx, latest.ry, rm);
      lastStatT = now;
    }
  }
  requestAnimationFrame(frame);
}
function statLine(ax, ay, m) {
  const x = ax?.norm ?? 0, y = ay?.norm ?? 0;
  return `x:${fmt(x)}  y:${fmt(y)}<br>` +
    `<span style="color:${m.color}">${t('stat_offset')} ${(m.offset * 100).toFixed(1)}% · ` +
    `${t('stat_wander')} ${(m.wander * 50).toFixed(1)}%</span> · ${t('stat_max')} ${(m.peak * 100).toFixed(1)}%`;
}
function fmt(v) { return (v >= 0 ? '+' : '') + v.toFixed(3); }
requestAnimationFrame(frame);

// ---------- mode controls ----------
function setMode(m) {
  leftPad.setMode(m); rightPad.setMode(m);
  $('mode-fade').classList.toggle('active', m === 'fade');
  $('mode-persist').classList.toggle('active', m === 'persist');
}
$('mode-fade').addEventListener('click', () => setMode('fade'));
$('mode-persist').addEventListener('click', () => setMode('persist'));
$('clear').addEventListener('click', () => {
  leftPad.clear(); rightPad.clear(); leftPad.clearRange(); rightPad.clearRange();
});
setMode('fade');

// ---------- rest test ----------
$('rest-test').addEventListener('click', () => {
  if (!connected) return;
  const btn = $('rest-test');
  btn.disabled = true;
  $('rest-result').innerHTML = '';
  setMode('persist'); leftPad.clear(); rightPad.clear();
  const secs0 = +($('rest-secs')?.value || 5);
  let secs = secs0;
  btn.textContent = t('rec_hold', { s: secs });
  const tick = setInterval(() => { secs--; if (secs > 0) btn.textContent = t('rec_hold', { s: secs }); }, 1000);
  recorder.start(secs0 * 1000, (report) => {
    clearInterval(tick);
    btn.disabled = false;
    btn.textContent = t('rest_test');
    showRestReport(report);
  });
});

function showRestReport(report) {
  const v = (k) => k === 'clean' ? `🟢 ${t('v_clean')}` : k === 'small' ? `🟡 ${t('v_small')}` : `🔴 ${t('v_drift')}`;
  const row = (labelKey, side) =>
    `<tr><td>${t(labelKey)}</td><td>${pct(side.offset)}</td><td>${pct(side.jitter / 2)}</td>` +
    `<td>x ${sg(side.x?.mean)} / y ${sg(side.y?.mean)}</td><td>${v(side.verdict)}</td></tr>`;
  $('rest-result').innerHTML =
    `<table><thead><tr><th>${t('th_stick')}</th><th>${t('th_offset')}</th><th>${t('th_jitter')}</th>` +
    `<th>${t('th_mean')}</th><th>${t('th_verdict')}</th></tr></thead>` +
    `<tbody>${row('left', report.sticks.left)}${row('right', report.sticks.right)}</tbody></table>` +
    `<p>${t('rest_note', { n: report.count })}</p>`;
}
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const sg = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3));

// ---------- range / reach test ----------
$('range-test').addEventListener('click', () => {
  if (!connected) return;
  const btn = $('range-test');
  btn.disabled = true;
  $('range-result').innerHTML = '';
  leftPad.setRangeRecording(true); rightPad.setRangeRecording(true);
  let secs = 8;
  btn.textContent = t('rotate', { s: secs });
  const tick = setInterval(() => { secs--; if (secs > 0) btn.textContent = t('rotate', { s: secs }); }, 1000);
  setTimeout(() => {
    clearInterval(tick);
    leftPad.setRangeRecording(false); rightPad.setRangeRecording(false);
    btn.disabled = false;
    btn.textContent = t('range_test');
    showRangeReport(leftPad.rangeStats(), rightPad.rangeStats());
  }, 8000);
});

function showRangeReport(l, r) {
  const row = (labelKey, s) => {
    const verdict = s.touched < 24 ? t('r_rotate_more')
      : (s.weak === 0 && s.maxReach >= 0.9) ? t('r_full')
      : (s.weak <= 4) ? t('r_some') : t('r_loss');
    return `<tr><td>${t(labelKey)}</td><td>${Math.round(s.coverage * 100)}%</td>` +
      `<td>${(s.maxReach * 100).toFixed(0)}%</td><td>${(s.minReach * 100).toFixed(0)}%</td>` +
      `<td>${s.weak}</td><td>${verdict}</td></tr>`;
  };
  $('range-result').innerHTML =
    `<table><thead><tr><th>${t('th_stick')}</th><th>${t('th_coverage')}</th><th>${t('th_max')}</th>` +
    `<th>${t('th_min')}</th><th>${t('th_weak')}</th><th>${t('th_verdict')}</th></tr></thead>` +
    `<tbody>${row('left', l)}${row('right', r)}</tbody></table>` +
    `<p>${t('range_note')}</p>`;
}

// ---------- export ----------
$('export-png').addEventListener('click', () => exportPNG());
$('export-csv').addEventListener('click', () => {
  if (recorder.recording) return;   // don't export a partial in-flight recording
  if (!recorder.samples.length) { alert(t('csv_empty')); return; }
  download(`stickdrift-${stamp()}.csv`, recorder.toCSV(), 'text/csv');
});

function exportPNG() {
  const pad = 300, gap = 40, W = pad * 2 + gap + 40, H = pad + 110;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#07080a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#46d6ff'; ctx.font = '16px monospace';
  ctx.fillText(`${deviceInfo?.productName || 'Controller'} — ${new Date().toLocaleString()}`, 20, 28);
  ctx.drawImage(leftPad.canvas, 20, 50, pad, pad);
  ctx.drawImage(rightPad.canvas, 20 + pad + gap, 50, pad, pad);
  ctx.fillStyle = '#9ece6a'; ctx.font = '14px monospace';
  ctx.fillText(t('left_stick'), 20, 50 + pad + 24);
  ctx.fillText(t('right_stick'), 20 + pad + gap, 50 + pad + 24);
  c.toBlob((blob) => download(`stickdrift-${stamp()}.png`, blob, 'image/png', true));
}

function download(name, data, type, isBlob = false) {
  const blob = isBlob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }

// ---------- language switch ----------
function updateLangButtons() {
  document.querySelectorAll('#lang-switch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.lang === getLang()));
}
document.querySelectorAll('#lang-switch button').forEach((b) =>
  b.addEventListener('click', () => setLang(b.dataset.lang)));
window.addEventListener('languagechange', () => {
  updateLangButtons();
  renderSupport();
  setLed(connected ? 'on' : 'off');
  renderDevInfo();
  if (connected && deviceInfo) buttons.build(deviceInfo);
  updateBugLink();
});
updateLangButtons();

// ---------- live GitHub star count (graceful, no auth) ----------
fetch('https://api.github.com/repos/speakman/switch-controller-tester')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    if (d && typeof d.stargazers_count === 'number' && d.stargazers_count > 0) {
      $('star-count').textContent = String(d.stargazers_count);
    }
  })
  .catch(() => {});

// ---------- prefilled bug-report link (auto-fills the issue's environment) ----------
function updateBugLink() {
  const a = $('bug-link');
  if (!a) return;
  const env = [
    `User agent: ${navigator.userAgent}`,
    `WebHID: ${ControllerHID.supported() ? 'yes' : 'no'}`,
    `Secure context: ${window.isSecureContext ? 'yes' : 'no'}`,
    `Language: ${getLang()}`,
    deviceInfo
      ? `Controller: ${deviceInfo.productName} (VID 0x${deviceInfo.vendorId.toString(16)}, PID 0x${deviceInfo.productId.toString(16)}, ${deviceInfo.buttonCount} buttons, axes ${deviceInfo.axes.join('/') || '—'})`
      : 'Controller: (none connected)',
    `Page: ${location.href}`,
  ].join('\n');
  a.href = 'https://github.com/speakman/switch-controller-tester/issues/new'
    + '?template=bug_report.yml&environment=' + encodeURIComponent(env);
}
updateBugLink();
