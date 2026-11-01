import assert from 'node:assert/strict';
import { layoutR6, layoutR15, faceRectsFor, TEMPLATE, DEFAULT_SCALES, brickHex, FACE_ORDER } from '../src/avatar/rigs.js';
import { extractContentId } from '../src/avatar/api.js';

const top = (p) => p.center[1] + p.size[1] / 2;
const bot = (p) => p.center[1] - p.size[1] / 2;
const by = (arr) => Object.fromEntries(arr.map((p) => [p.name, p]));

// R6: 足裏がy=0、胴・腕・脚の位置が標準どおり
const r6 = by(layoutR6());
assert.equal(Object.keys(r6).length, 6);
assert.equal(bot(r6['Left Leg']), 0);
assert.equal(top(r6['Torso']), 4);
assert.equal(r6['Right Arm'].center[0], 1.5);

// R15: 15パーツ、足裏0、パーツが縦につながっている(隙間なし)、NaNなし
const r15 = by(layoutR15(DEFAULT_SCALES));
assert.equal(Object.keys(r15).length, 15);
assert.equal(bot(r15.LeftFoot), 0);
for (const side of ['Left', 'Right']) {
  assert.ok(bot(r15[`${side}LowerLeg`]) <= top(r15[`${side}Foot`]) + 1e-9, 'foot-lowerleg gap');
  assert.ok(bot(r15[`${side}UpperLeg`]) <= top(r15[`${side}LowerLeg`]) + 1e-9, 'lower-upper leg gap');
  assert.ok(bot(r15.LowerTorso) <= top(r15[`${side}UpperLeg`]) + 1e-9, 'hip gap');
  assert.ok(bot(r15[`${side}LowerArm`]) <= bot(r15[`${side}UpperArm`]) + 0.2 && top(r15[`${side}LowerArm`]) >= bot(r15[`${side}UpperArm`]), 'arm gap');
  assert.ok(top(r15[`${side}Hand`]) >= bot(r15[`${side}LowerArm`]), 'hand gap');
}
assert.ok(bot(r15.UpperTorso) <= top(r15.LowerTorso) + 1e-9, 'torso gap');
assert.ok(bot(r15.Head) <= top(r15.UpperTorso));
for (const p of Object.values(r15)) for (const v of [...p.size, ...p.center]) assert.ok(Number.isFinite(v));
const h15 = Math.max(...Object.values(r15).map(top));
console.log('R6 height', Math.max(...Object.values(r6).map(top)).toFixed(2), '/ R15 height', h15.toFixed(2));

// スケール: 身長・幅が反映される
const tall = by(layoutR15({ ...DEFAULT_SCALES, height: 1.1, width: 0.9 }));
assert.ok(top(tall.Head) > top(r15.Head));
assert.ok(Math.abs(tall.UpperTorso.size[0] - 1.8) < 1e-9);

// UV矩形: 全てテンプレート内、面順は6面
const slices = [[0, 1], [0, 0.4], [0.4, 1], [0.8, 1]];
for (const k of ['torso', 'lArm', 'rArm', 'lLeg', 'rLeg']) {
  for (const sl of slices) {
    const rects = faceRectsFor(k, sl);
    assert.equal(rects.length, FACE_ORDER.length);
    for (const [x, y, w, h] of rects) {
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= TEMPLATE.w + 1e-9 && y + h <= TEMPLATE.h + 1e-9, `${k} ${sl} out of template`);
    }
  }
}
// R15の上下スライスが元の矩形をちょうど分割している
const full = faceRectsFor('torso', [0, 1])[5];
const up = faceRectsFor('torso', [0, 0.8])[5], lo = faceRectsFor('torso', [0.8, 1])[5];
assert.ok(Math.abs(up[3] + lo[3] - full[3]) < 1e-9 && Math.abs(up[1] + up[3] - lo[1]) < 1e-9);

// 色
assert.equal(brickHex(1001), '#F8F8F8');
assert.equal(brickHex(99999), '#A3A2A5');

// XMLアセットからの画像ID抽出
const enc = (s) => new TextEncoder().encode(s).buffer;
assert.equal(extractContentId(enc('<roblox xmlns:xmime="x"><Item class="Shirt"><Properties><Content name="ShirtTemplate"><url>http://www.roblox.com/asset/?id=123456</url></Content></Properties></Item></roblox>')), 123456);
assert.equal(extractContentId(enc('<url>rbxassetid://987</url>')), 987);
assert.equal(extractContentId(enc('<roblox!\x89\xff\r\n\x1a\n')), null);
console.log('OK');
