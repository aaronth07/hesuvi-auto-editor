(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HesuviMaterials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = x => Math.max(0, Math.min(1, x));
  const linear = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  const encoded = x => x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055;
  function rawRgb(L, C, H) {
    const angle = H * Math.PI / 180, a = C * Math.cos(angle), b = C * Math.sin(angle);
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
    const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
    const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
      -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
  }
  function gamut(L, C, H) {
    let rgb = rawRgb(L, C, H);
    const inside = v => v.every(x => x >= -1e-7 && x <= 1.0000001);
    if (!inside(rgb)) {
      let low = 0, high = C;
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (inside(rawRgb(L, mid, H))) low = mid; else high = mid;
      }
      rgb = rawRgb(L, low, H);
    }
    return rgb.map(x => clamp(encoded(clamp(x))));
  }
  function fromRgb(rgb, source) {
    const [r, g, b] = rgb.map(linear);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    const L = .2104542553 * l + .793617785 * m - .0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
    const bb = .0259040371 * l + .7827717662 * m - .808675766 * s;
    const C = Math.hypot(a, bb);
    return {L, C, H: C < 1e-7 ? 0 : (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360, rgb, source};
  }
  function parseColor(source) {
    if (typeof source !== 'string') return null;
    const value = source.trim();
    const hex = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(value);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      return fromRgb([0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255), source);
    }
    const number = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?)';
    const match = new RegExp('^oklch\\(\\s*' + number + '(%)?\\s+' + number + '\\s+' + number + '\\s*\\)$', 'i').exec(value);
    if (!match) return null;
    const L = Number(match[1]) / (match[2] ? 100 : 1), C = Number(match[3]), H = Number(match[4]);
    if (![L, C, H].every(Number.isFinite) || L < 0 || L > 1 || C < 0 || C > .5 || H < 0 || H > 360) return null;
    return {L, C, H, rgb: gamut(L, C, H), source};
  }
  function rgbOf(value) {
    if (Array.isArray(value) && value.length === 3 && value.every(x => Number.isFinite(x) && x >= 0 && x <= 1)) return value;
    if (value && Array.isArray(value.rgb)) return rgbOf(value.rgb);
    const parsed = parseColor(value);
    if (!parsed) throw new TypeError('Expected an OKLCH or hexadecimal color');
    return parsed.rgb;
  }
  function toHex(value) { return '#' + rgbOf(value).map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
  const luminance = rgb => rgb.map(linear).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  function contrast(a, b) {
    const x = luminance(rgbOf(a)), y = luminance(rgbOf(b));
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  const over = (fg, bg, alpha) => fg.map((x, i) => x * alpha + bg[i] * (1 - alpha));
  function color(L, C, H, alpha) {
    let low = 0, high = C;
    if (rawRgb(L, C, H).some(x => x < 0 || x > 1)) {
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (rawRgb(L, mid, H).every(x => x >= 0 && x <= 1)) low = mid; else high = mid;
      }
      C = Math.floor(low * 1e6) / 1e6;
    }
    return `oklch(${L.toFixed(6)} ${C.toFixed(6)} ${H.toFixed(4)}${alpha === undefined ? '' : ' / ' + alpha.toFixed(6)})`;
  }
  function materialTokens(theme, baseString) {
    if (theme !== 'dark' && theme !== 'light') throw new TypeError('Expected dark or light theme');
    const dark = theme !== 'light';
    if (baseString === undefined) baseString = dark ? 'oklch(0.1558 0.0063 285.64)' : 'oklch(0.94 0.0063 285.64)';
    const base = parseColor(baseString);
    if (!base) throw new TypeError('Invalid base color');
    const noiseAlpha = .008;
    const noisy = rgb => [over([0, 0, 0], rgb, noiseAlpha), over([1, 1, 1], rgb, noiseAlpha)];
    const baseNoise = noisy(base.rgb);
    const blackText = Math.min(...baseNoise.map(rgb => contrast([0, 0, 0], rgb))) >= Math.min(...baseNoise.map(rgb => contrast([1, 1, 1], rgb)));
    const foreground = blackText ? [0, 0, 0] : [1, 1, 1];
    const tintL = blackText ? Math.max(.86, base.L - .04) : Math.min(base.L + .12, .30);
    const tintC = Math.min(base.C, .018), tint = gamut(tintL, tintC, base.H);
    const alphas = {workspace: .08, panel: dark ? .42 : .48, control: dark ? .36 : .4, popup: dark ? .30 : .36};
    const ambientL = dark ? .70 : .84, ambientC = dark ? .12 : .075;
    const ambientHues = [250, 190, 65];
    const ambientColors = ambientHues.map(H => rgbOf(color(ambientL, ambientC, H)));
    function ambientBounds(alpha) {
      const corners = [];
      for (let mask = 0; mask < 8; mask++) {
        let rgb = base.rgb;
        for (let i = 0; i < 3; i++) if (mask & (1 << i)) rgb = over(ambientColors[i], rgb, alpha);
        corners.push(rgb);
      }
      return [0, 1].map(side => [0, 1, 2].map(channel => Math[side ? 'max' : 'min'](...corners.map(rgb => rgb[channel]))));
    }
    // Channel bounds include every overlap and intermediate radial-gradient opacity.
    let ambientStep = dark ? 121 : 88;
    while (ambientStep > 0 && ambientBounds(ambientStep / 1000).flatMap(noisy).some(rgb => contrast(foreground, rgb) < 4.53)) ambientStep--;
    const ambientAlpha = ambientStep / 1000, ambientEnvelope = ambientBounds(ambientAlpha);
    const surfaces = {base: base.rgb};
    surfaces.workspace = over(tint, base.rgb, alphas.workspace);
    surfaces.panel = over(tint, base.rgb, alphas.panel);
    surfaces.control = over(tint, surfaces.panel, alphas.control);
    surfaces.popup = over(tint, surfaces.panel, alphas.popup);
    surfaces.panelWorkspace = over(tint, surfaces.workspace, alphas.panel);
    surfaces.controlBase = over(tint, base.rgb, alphas.control);
    surfaces.controlWorkspace = over(tint, surfaces.workspace, alphas.control);
    surfaces.controlPanelWorkspace = over(tint, surfaces.panelWorkspace, alphas.control);
    surfaces.popupBase = over(tint, base.rgb, alphas.popup);
    surfaces.popupWorkspace = over(tint, surfaces.workspace, alphas.popup);
    surfaces.popupPanelWorkspace = over(tint, surfaces.panelWorkspace, alphas.popup);
    const plotBackgrounds = [surfaces.workspace];
    for (let i = 0; i < ambientEnvelope.length; i++) {
      const ambient = ambientEnvelope[i], prefix = i ? 'ambientMaximum' : 'ambientMinimum';
      const workspace = over(tint, ambient, alphas.workspace), panel = over(tint, ambient, alphas.panel);
      const panelWorkspace = over(tint, workspace, alphas.panel);
      surfaces[prefix + 'Header'] = ambient;
      surfaces[prefix + 'Workspace'] = workspace;
      surfaces[prefix + 'Panel'] = panel;
      surfaces[prefix + 'PanelWorkspace'] = panelWorkspace;
      for (const [name, bg] of Object.entries({Base: ambient, Workspace: workspace, Panel: panel, PanelWorkspace: panelWorkspace})) {
        surfaces[prefix + 'Control' + name] = over(tint, bg, alphas.control);
        surfaces[prefix + 'Popup' + name] = over(tint, bg, alphas.popup);
      }
      plotBackgrounds.push(workspace, rgbOf(toHex(workspace)));
    }
    let highlightAlpha = .10;
    const highlighted = () => Object.entries(surfaces).filter(([key]) => key !== 'base' && !key.endsWith('Header')).flatMap(([, rgb]) => {
      const first = over([1, 1, 1], rgb, highlightAlpha);
      return [first, over([1, 1, 1], first, highlightAlpha)];
    });
    while (highlightAlpha > 0 && highlighted().flatMap(noisy).some(rgb => contrast(foreground, rgb) < 4.5)) highlightAlpha = Math.max(0, highlightAlpha - .001);
    const all = Object.values(surfaces).concat(highlighted(), Object.values(surfaces).map(rgb => rgbOf(toHex(rgb)))).flatMap(rgb => [rgb, ...noisy(rgb)]);
    const minContrast = rgb => Math.min(...all.map(bg => contrast(rgb, bg)));
    let muted = foreground;
    for (let amount = 72; amount <= 100; amount++) {
      muted = foreground.map(x => blackText ? 1 - amount / 100 : amount / 100);
      if (minContrast(rgbOf(toHex(muted))) >= 4.5) break;
    }
    const plotChecks = plotBackgrounds.concat([rgbOf(toHex(surfaces.workspace))]).flatMap(rgb => [rgb, ...noisy(rgb)]);
    function trace(H) {
      const preferred = blackText ? .40 : .80;
      let best = null;
      for (let i = 0; i <= 1000; i++) {
        const L = i / 1000, rgb = gamut(L, .16, H);
        if (plotChecks.every(bg => contrast(rgb, bg) >= 3.01) && (!best || Math.abs(L - preferred) < Math.abs(best.L - preferred))) best = {L, rgb};
      }
      return {rgb: best.rgb, css: color(best.L, .16, H)};
    }
    const left = trace(250), right = trace(55);
    const authored = rgb => { const c = fromRgb(rgb); return color(c.L, c.C, c.H); };
    const css = {'--base': baseString, '--text': authored(foreground), '--muted': authored(rgbOf(toHex(muted))), '--border': authored(over(foreground, surfaces.panel, .16)),
      '--accent': left.css, '--accent-text': color(contrast(left.rgb, [0, 0, 0]) >= 4.5 ? 0 : 1, 0, 0), '--focus': left.css,
      '--left-trace': left.css, '--right-trace': right.css, '--grid': authored(over(foreground, surfaces.workspace, .18)),
      '--shadow': 'oklch(0 0 0 / 0.24)', '--highlight': color(1, 0, base.H, highlightAlpha),
      '--error-bg': blackText ? 'oklch(0.94 0.025 25)' : 'oklch(0.23 0.035 25)', '--error-text': authored(rgbOf(blackText ? '#6b1010' : '#ffcccc'))};
    for (const key of Object.keys(alphas)) css['--' + key] = color(tintL, tintC, base.H, alphas[key]);
    for (let i = 0; i < 3; i++) css['--ambient-' + ['a', 'b', 'c'][i]] = color(ambientL, ambientC, ambientHues[i], ambientAlpha);
    for (const key of ['panel', 'control', 'popup']) css['--' + key + '-solid'] = authored(surfaces[key]);
    const canvas = {background: toHex(surfaces.workspace), text: css['--text'], muted: css['--muted'], grid: css['--grid'], left: left.css, right: right.css,
      edge: css['--border'], reflectionLeft: left.css, reflectionRight: right.css};
    const renderedText = rgbOf(css['--text']), renderedMuted = rgbOf(css['--muted']);
    return {css, canvas, contrastReport: {minimumText: minContrast(renderedText), minimumMuted: minContrast(renderedMuted),
      minimumTrace: Math.min(...plotChecks.map(bg => Math.min(contrast(canvas.left, bg), contrast(canvas.right, bg)))),
      left: Math.min(...plotChecks.map(bg => contrast(canvas.left, bg))), right: Math.min(...plotChecks.map(bg => contrast(canvas.right, bg))), highlightAlpha,
      ambientAlpha, ambientCombinedAlpha: 1 - (1 - ambientAlpha) ** 3, noiseAlpha,
      ambientEnvelope: ambientEnvelope.map(toHex),
      surfaces: Object.fromEntries(Object.entries(surfaces).map(([key, rgb]) => [key, toHex(rgb)]))}};
  }
  return {parseColor, materialTokens, contrast, toHex};
});
