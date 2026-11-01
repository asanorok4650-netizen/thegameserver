// ビルダー/デモのスモークテスト + 服UVの向き検証(three非依存のスタブで実行)
import assert from 'node:assert/strict';

const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };

const { buildAvatar } = await import('../src/avatar/builder.js');
const { DEMOS } = await import('../src/avatar/demo.js');
const { TEMPLATE } = await import('../src/avatar/rigs.js');

// 1) 全デモが組み立てられる
for (const d of DEMOS) {
  const built = buildAvatar(d.make());
  const body = built.parts.filter((p) => !p.accessory); // アクセサリ(帽子)は別枠で数える
  assert.ok(body.length === (built.rigType === 'R6' ? 6 : 15), d.label);
  assert.equal(built.parts.length - body.length, (d.make().accessories || []).length, `${d.label} アクセサリ数`);
  assert.ok(Number.isFinite(built.box.max.y) && built.box.min.y > -0.5, `${d.label} box`);
}
const clothed = buildAvatar(DEMOS.find((d) => d.id === 'demo-clothes').make());
assert.ok(clothed.parts.find((p) => p.name === 'Torso').clothed && !clothed.parts.find((p) => p.name === 'Head').clothed);
const r15c = buildAvatar(DEMOS.find((d) => d.id === 'demo-r15-clothes').make());
assert.ok(r15c.parts.find((p) => p.name === 'UpperTorso').clothed && !r15c.parts.find((p) => p.name === 'LeftHand').clothed);

// 2) UVの向き: 画像上の「右」「上」が3D上のどちらに対応するか(アバターを外側から見た向き)
const uvTest = buildAvatar(DEMOS.find((d) => d.id === 'demo-uv').make());
const torso = uvTest.parts.find((p) => p.name === 'Torso').object;
const pos = torso.geometry.attributes.position, uv = torso.geometry.attributes.uv;
const expect = { // 面idx: [画像の右が向く3D軸, 画像の上が向く3D軸]
  0: ['-z', '+y'],  // right(+x面)
  1: ['+z', '+y'],  // left(-x面)
  2: ['-x', '+z'],  // top    (テンプレ上では正面が画像の下)
  3: ['-x', '-z'],  // bottom (テンプレ上では正面が画像の上)
  4: ['+x', '+y'],  // back
  5: ['-x', '+y'],  // front
};
const axis = (s) => ({ x: 0, y: 1, z: 2 })[s[1]] * 1 + 0 * 0, sign = (s) => (s[0] === '+' ? 1 : -1);
const get = (i, a) => [pos.getX(i), pos.getY(i), pos.getZ(i)][a];
for (let f = 0; f < 6; f++) {
  const [r, u] = expect[f];
  for (const [dirSpec, imgAxis] of [[r, 'x'], [u, 'y']]) {
    let agree = 0, total = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = f * 4 + i, b = f * 4 + j;
      const d3 = (get(b, axis(dirSpec)) - get(a, axis(dirSpec))) * sign(dirSpec);
      // テクスチャ空間ではu=右、v=上が正(flipY有効のCanvasTexture)
      const dImg = imgAxis === 'x' ? (uv.getX(b) - uv.getX(a)) * TEMPLATE.w : (uv.getY(b) - uv.getY(a)) * TEMPLATE.h;
      if (Math.abs(d3) > 1e-6 && Math.abs(dImg) > 1e-6) { total++; if (Math.sign(d3) === Math.sign(dImg)) agree++; }
    }
    assert.ok(total > 0 && agree === total, `面${f} 画像${imgAxis}方向が ${dirSpec} と一致しない (${agree}/${total})`);
  }
}
console.log('builder OK');
