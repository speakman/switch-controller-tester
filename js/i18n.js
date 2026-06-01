// Tiny dependency-free i18n. Default English; Swedish selectable; auto-detects
// from navigator.language on first visit; choice persisted to localStorage.
//
// Static DOM text uses [data-i18n="key"]. Dynamic strings call t(key, params),
// with {placeholders} substituted. On language change a 'languagechange' event
// is dispatched on window so the app can re-render dynamic content.

const STR = {
  en: {
    kicker: 'WebHID · Controller Diagnostic',
    sub: "Test every button, the D-pad and both sticks right in your browser — with instrument-grade tools for finding stick drift. Reads the controller via WebHID, so even clones the Gamepad API can't see will work.",
    led_off: 'Not connected', led_on: 'Connected', led_lost: 'Disconnected',
    connect: 'Connect controller',
    no_device: 'No device selected.',
    connect_error: "Couldn't open the controller",
    ns_title: 'WebHID isn’t supported in this browser',
    ns_body: 'This tester reads your controller directly through the WebHID API, which needs a Chromium-based desktop browser served over HTTPS or http://localhost.',
    ns_works: 'Works in Chrome, Edge, Opera, Brave and Arc (desktop).',
    ns_no: 'Safari, Firefox and most mobile browsers can’t run it.',
    ns_secure: 'Insecure page — open this over HTTPS or http://localhost, otherwise WebHID is blocked.',
    p1_title: 'Analog sticks',
    legend: '🟢 clean · 🟡 small offset · 🔴 drift',
    mode_fade: 'Fade', mode_persist: 'Keep trail', clear: 'Clear',
    rest_time: 'Rest time', rest_test: '⏺ Rest test', range_test: '🧭 Range test',
    left_stick: 'Left stick', right_stick: 'Right stick',
    hint: 'Keep the controller still. Yellow box = how far the stick wandered.',
    p2_title: 'Buttons & D-pad', connect_hint: 'Connect a controller to see the buttons.',
    idle_title: 'Connect a controller to begin',
    idle_body: 'Click “Connect controller” above and pick your Switch controller in the prompt. Every button lights up live, and you can run the drift tools on both sticks.',
    p3_title: 'Raw report',
    footer_req: 'Requires a Chromium browser (Chrome/Edge/Arc) over HTTPS or localhost.',
    star_cta: 'Star on GitHub', source_link: 'Source ↗',
    bug_link: 'Report a bug', feedback_link: 'Feedback',

    dev_buttons: 'buttons', dev_axes: 'axes', dev_dpad: ' · D-pad',
    stat_offset: 'offset', stat_wander: 'wander', stat_max: 'max',
    rec_hold: 'Recording… hold still ({s}s)',
    rotate: 'Rotate both sticks fully… ({s}s)',
    th_stick: 'Stick', th_offset: 'offset', th_jitter: 'jitter', th_mean: 'mean', th_verdict: 'verdict',
    th_coverage: 'coverage', th_max: 'max', th_min: 'min', th_weak: 'weak',
    left: 'Left', right: 'Right',
    v_clean: 'clean', v_small: 'small offset', v_drift: 'DRIFT',
    r_rotate_more: '⚪ rotate more', r_full: '🟢 full range', r_some: '🟡 some weak sectors', r_loss: '🔴 range loss',
    rest_note: '{n} samples. Wild swinging (large jitter) ≠ classic drift — compare a suspect stick against the other as a reference.',
    range_note: 'Rotate both sticks in full circles during the test. Purple/green dots = reached perimeter; red = below 80% range in that direction.',
    csv_empty: 'Run a rest test first (it creates data to export).',
    ident_hint: 'Press a button to identify its index.',
    ident_btn: 'Button {i}', ident_default: ' (default: {label})',
    subhead: 'All {n} exposed buttons · index → default label',
  },
  sv: {
    kicker: 'WebHID · Kontrollerdiagnostik',
    sub: 'Testa varje knapp, D-pad och båda sticken direkt i webbläsaren — med instrumentnivå-verktyg för att hitta stick drift. Läser kontrollern via WebHID, så även kloner som Gamepad-API:t inte ser fungerar.',
    led_off: 'Inte ansluten', led_on: 'Ansluten', led_lost: 'Frånkopplad',
    connect: 'Anslut kontroller',
    no_device: 'Ingen enhet vald.',
    connect_error: 'Kunde inte öppna kontrollern',
    ns_title: 'WebHID stöds inte i den här webbläsaren',
    ns_body: 'Testaren läser kontrollern direkt via WebHID-API:t, vilket kräver en Chromium-baserad desktop-webbläsare över HTTPS eller http://localhost.',
    ns_works: 'Fungerar i Chrome, Edge, Opera, Brave och Arc (desktop).',
    ns_no: 'Safari, Firefox och de flesta mobilwebbläsare klarar det inte.',
    ns_secure: 'Osäker sida — öppna via HTTPS eller http://localhost, annars blockeras WebHID.',
    p1_title: 'Analoga stickar',
    legend: '🟢 ren · 🟡 liten offset · 🔴 drift',
    mode_fade: 'Fade', mode_persist: 'Spara spår', clear: 'Rensa',
    rest_time: 'Vilotid', rest_test: '⏺ Vilotest', range_test: '🧭 Range-test',
    left_stick: 'Vänster stick', right_stick: 'Höger stick',
    hint: 'Lägg kontrollern stilla. Gul box = hur långt sticken vandrat.',
    p2_title: 'Knappar & D-pad', connect_hint: 'Anslut en kontroller för att se knapparna.',
    idle_title: 'Anslut en kontroller för att börja',
    idle_body: 'Klicka på "Anslut kontroller" ovan och välj din Switch-kontroller i dialogen. Varje knapp tänds live, och du kan köra drift-verktygen på båda sticken.',
    p3_title: 'Rå rapport',
    footer_req: 'Kräver Chromium (Chrome/Edge/Arc) över HTTPS eller localhost.',
    star_cta: 'Stjärnmärk på GitHub', source_link: 'Källkod ↗',
    bug_link: 'Rapportera en bugg', feedback_link: 'Feedback',

    dev_buttons: 'knappar', dev_axes: 'axlar', dev_dpad: ' · D-pad',
    stat_offset: 'offset', stat_wander: 'vandring', stat_max: 'max',
    rec_hold: 'Spelar in… håll stilla ({s}s)',
    rotate: 'Rotera båda sticken fullt… ({s}s)',
    th_stick: 'Stick', th_offset: 'offset', th_jitter: 'jitter', th_mean: 'medel', th_verdict: 'dom',
    th_coverage: 'täckning', th_max: 'max', th_min: 'min', th_weak: 'svaga',
    left: 'Vänster', right: 'Höger',
    v_clean: 'ren', v_small: 'liten offset', v_drift: 'DRIFT',
    r_rotate_more: '⚪ rotera mer', r_full: '🟢 full räckvidd', r_some: '🟡 några svaga sektorer', r_loss: '🔴 räckviddsförlust',
    rest_note: '{n} sampel. Vild svängning (stort jitter) ≠ klassisk drift — jämför misstänkt stick mot den andra som referens.',
    range_note: 'Rotera båda sticken i hela cirklar under testet. Lila/gröna punkter = uppnådd perimeter; röda = under 80% räckvidd i den riktningen.',
    csv_empty: 'Kör ett vilotest först (skapar data att exportera).',
    ident_hint: 'Tryck en knapp för att identifiera dess index.',
    ident_btn: 'Knapp {i}', ident_default: ' (standard: {label})',
    subhead: 'Alla {n} exponerade knappar · index → standardetikett',
  },
};

function detect() {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch {}   // localStorage can throw in privacy modes
  if (saved === 'en' || saved === 'sv') return saved;
  return (navigator.language || '').toLowerCase().startsWith('sv') ? 'sv' : 'en';
}

let lang = detect();

export function getLang() { return lang; }

export function t(key, params) {
  let s = (STR[lang] && STR[lang][key]) ?? STR.en[key] ?? key;
  if (params) for (const k in params) s = s.replaceAll(`{${k}}`, params[k]);
  return s;
}

export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

export function setLang(l) {
  if (l !== 'en' && l !== 'sv') return;
  lang = l;
  try { localStorage.setItem('lang', l); } catch {}   // privacy modes can throw SecurityError
  document.documentElement.lang = l;
  applyStatic();
  window.dispatchEvent(new CustomEvent('languagechange'));
}

// apply on load
document.documentElement.lang = lang;
if (document.readyState !== 'loading') applyStatic();
else document.addEventListener('DOMContentLoaded', () => applyStatic());
