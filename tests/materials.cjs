'use strict';
const assert = require('node:assert/strict');
const {parseColor, materialTokens, contrast, toHex} = require('../docs/materials.js');
const fs = require('node:fs');
const vm = require('node:vm');
const browser = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../docs/materials.js'), 'utf8'), browser);
assert.equal(typeof browser.HesuviMaterials.materialTokens, 'function');
for (const invalid of [null, '', 'red', '#12', '#12345678', 'oklch(NaN 0 0)', 'oklch(1.1 0 0)', 'oklch(20% -1 0)', 'oklch(.5 .1 361)', 'oklch(.5 .1 20 / .5)', 'oklch(.5 .1 20) junk']) assert.equal(parseColor(invalid), null);
assert.equal(toHex('#abc'), '#aabbcc');
assert.equal(contrast('#000', '#fff'), 21);
assert.equal(parseColor('oklch(50% .1 250)').L, .5);
assert.deepEqual(parseColor('oklch(.5 .5 250)').rgb.map(x => x >= 0 && x <= 1), [true, true, true]);
const over = (fg, bg, alpha) => fg.map((x, i) => x * alpha + bg[i] * (1 - alpha));
const withNoise = rgb => [rgb, over([0, 0, 0], rgb, .008), over([1, 1, 1], rgb, .008)];
function translucent(value) {
  const match = /^(oklch\(.+) \/ ([\d.]+)\)$/.exec(value);
  assert.ok(match, value);
  return {rgb: parseColor(match[1] + ')').rgb, alpha: Number(match[2])};
}
function verifyAmbient(result) {
  const css = result.css;
  const lights = ['a', 'b', 'c'].map(key => translucent(css['--ambient-' + key]));
  const layers = Object.fromEntries(['workspace', 'panel', 'control', 'popup', 'highlight'].map(key => [key, translucent(css['--' + key])]));
  const apply = (name, rgb) => over(layers[name].rgb, rgb, layers[name].alpha);
  for (const a of [0, .5, 1]) for (const b of [0, .5, 1]) for (const c of [0, .5, 1]) {
    let header = parseColor(css['--base']).rgb;
    for (let i = 0; i < 3; i++) header = over(lights[i].rgb, header, lights[i].alpha * [a, b, c][i]);
    const workspace = apply('workspace', header), panel = apply('panel', header), panelWorkspace = apply('panel', workspace);
    const surfaces = [workspace, panel, panelWorkspace];
    for (const bg of [header, workspace, panel, panelWorkspace]) surfaces.push(apply('control', bg), apply('popup', bg));
    const nestedHighlights = [];
    for (const parent of [panel, panelWorkspace, apply('popup', header), apply('popup', panel)]) {
      const highlightedParent = apply('highlight', parent);
      for (const child of ['control', 'workspace']) nestedHighlights.push(apply('highlight', apply(child, highlightedParent)));
    }
    for (const bg of [header, ...surfaces, ...surfaces.map(rgb => apply('highlight', rgb)), ...nestedHighlights].flatMap(withNoise)) {
      assert.ok(contrast(css['--text'], bg) >= 4.5);
      assert.ok(contrast(css['--muted'], bg) >= 4.5);
    }
    for (const bg of withNoise(workspace)) {
      assert.ok(contrast(result.canvas.left, bg) >= 3);
      assert.ok(contrast(result.canvas.right, bg) >= 3);
    }
  }
}
let minimumSimpleText = Infinity, minimumSimpleMuted = Infinity;
function verifySimple(result) {
  const css = result.css, highlight = translucent(css['--highlight']);
  const surfaces = ['panel', 'control', 'popup'].map(key => {
    const color = parseColor(css['--' + key + '-solid']);
    assert.ok(color, key);
    assert.doesNotMatch(css['--' + key + '-solid'], /\//);
    return color.rgb;
  });
  const firstHighlight = surfaces.map(rgb => over(highlight.rgb, rgb, highlight.alpha));
  for (const bg of [...surfaces, ...firstHighlight, ...firstHighlight.map(rgb => over(highlight.rgb, rgb, highlight.alpha))].flatMap(withNoise)) {
    const text = contrast(css['--text'], bg), muted = contrast(css['--muted'], bg);
    assert.ok(text >= 4.5, `Simple text: ${text}`);
    assert.ok(muted >= 4.5, `Simple muted: ${muted}`);
    minimumSimpleText = Math.min(minimumSimpleText, text);
    minimumSimpleMuted = Math.min(minimumSimpleMuted, muted);
  }
}
let minimumText = Infinity, minimumMuted = Infinity, minimumTrace = Infinity;
for (const theme of ['dark', 'light']) {
  for (const base of [undefined, '#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', 'oklch(.56 .02 285)']) {
    const result = materialTokens(theme, base);
    if (base !== undefined) assert.equal(result.css['--base'], base);
    for (const [key, value] of Object.entries(result.css)) if (key !== '--base') assert.match(value, /^oklch\(/);
    verifyAmbient(result);
    verifySimple(result);
    const report = result.contrastReport;
    assert.ok(report.minimumText >= 4.5, `${theme} ${base}: text ${report.minimumText}`);
    assert.ok(report.minimumMuted >= 4.5, `${theme} ${base}: muted ${report.minimumMuted}`);
    assert.ok(report.minimumTrace >= 3, `${theme} ${base}: trace ${report.minimumTrace}`);
    assert.ok(contrast(result.canvas.text, result.canvas.background) >= 4.5);
    assert.ok(contrast(result.canvas.muted, result.canvas.background) >= 4.5);
    assert.ok(contrast(result.css['--accent'], result.css['--accent-text']) >= 4.5);
    for (const value of Object.values(result.canvas)) assert.ok(parseColor(value), value);
    assert.equal(parseColor(result.canvas.left).H, 250);
    assert.equal(parseColor(result.canvas.right).H, 55);
    for (const key of ['workspace', 'panel', 'control', 'popup']) assert.match(result.css['--' + key], /^oklch\(.+ \/ .+\)$/);
    for (const key of ['panel', 'control', 'popup']) assert.ok(parseColor(result.css['--' + key + '-solid']));
    assert.ok(contrast(result.css['--error-bg'], result.css['--error-text']) >= 4.5);
    for (const bg of Object.values(report.surfaces)) assert.ok(contrast(result.css['--text'], bg) >= 4.5);
    minimumText = Math.min(minimumText, report.minimumText);
    minimumMuted = Math.min(minimumMuted, report.minimumMuted);
    minimumTrace = Math.min(minimumTrace, report.minimumTrace);
  }
}
for (let i = 0; i < 48; i++) {
  const rgb = [Math.sin(i * 1.7), Math.sin(i * 2.3 + 1), Math.sin(i * 3.1 + 2)].map(x => (x + 1) / 2);
  const result = materialTokens(i % 2 ? 'light' : 'dark', toHex(rgb));
  verifySimple(result);
  assert.ok(result.contrastReport.minimumText >= 4.5);
  assert.ok(result.contrastReport.minimumMuted >= 4.5);
  assert.ok(result.contrastReport.minimumTrace >= 3);
}
assert.throws(() => materialTokens('dark', 'invalid'), TypeError);
assert.throws(() => materialTokens('invalid', '#fff'), TypeError);
const defaultDark = materialTokens('dark');
assert.notEqual(defaultDark.contrastReport.surfaces.base, defaultDark.contrastReport.surfaces.panel);
assert.equal(defaultDark.css['--base'], 'oklch(0.1558 0.0063 285.64)');
assert.equal(materialTokens('light').css['--base'], 'oklch(0.94 0.0063 285.64)');
assert.ok(defaultDark.contrastReport.ambientCombinedAlpha >= .2);
assert.equal(defaultDark.contrastReport.ambientAlpha, .260);
assert.equal(materialTokens('light').contrastReport.ambientAlpha, .180);
assert.equal(defaultDark.contrastReport.noiseAlpha, .008);
assert.ok(materialTokens('dark', 'oklch(.56 .02 285)').contrastReport.ambientAlpha < defaultDark.contrastReport.ambientAlpha);
console.log(`Materials passed: text ${minimumText.toFixed(3)}, muted ${minimumMuted.toFixed(3)}, traces ${minimumTrace.toFixed(3)}`);
console.log(`Simple materials passed: text ${minimumSimpleText.toFixed(3)}, muted ${minimumSimpleMuted.toFixed(3)}`);
