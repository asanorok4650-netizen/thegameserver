// テスト専用: バイナリrbxmを作るエンコーダ(パーサの検証用)
const te = new TextEncoder();
export const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return [...b]; };
export const str = (s) => { const b = te.encode(s); return [...u32(b.length), ...b]; };
const interleave = (vals) => { const n = vals.length, out = new Array(n * 4); vals.forEach((v, i) => { out[i] = (v >>> 24) & 255; out[n + i] = (v >>> 16) & 255; out[2 * n + i] = (v >>> 8) & 255; out[3 * n + i] = v & 255; }); return out; };
export const encU32s = (a) => interleave(a);
export const encI32s = (a) => interleave(a.map((n) => ((n << 1) ^ (n >> 31)) >>> 0));
export const encF32s = (a) => interleave(a.map((f) => { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, f); const bits = dv.getUint32(0); return ((bits << 1) | (bits >>> 31)) >>> 0; }));
export const encRefs = (a) => { let prev = 0; return encI32s(a.map((r) => { const d = r - prev; prev = r; return d; })); };
export const rawF32 = (f) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, f, true); return [...b]; };

export function lz4Literal(data) { // リテラルのみのLZ4ブロック
  const n = data.length, out = [Math.min(n, 15) << 4];
  if (n >= 15) { let r = n - 15; while (r >= 255) { out.push(255); r -= 255; } out.push(r); }
  return [...out, ...data];
}
export function chunk(tag, data, compress = false) {
  const name = [...tag].map((c) => c.charCodeAt(0));
  if (!compress) return [...name, ...u32(0), ...u32(data.length), 0, 0, 0, 0, ...data];
  const comp = lz4Literal(data);
  return [...name, ...u32(comp.length), ...u32(data.length), 0, 0, 0, 0, ...comp];
}
export function file(chunks, classCount, instCount) {
  const head = [...te.encode('<roblox!'), 0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, ...u32(classCount), ...u32(instCount), 0, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([...head, ...chunks.flat(), ...chunk('END\0', [...te.encode('</roblox>')])]);
}
export const inst = (id, name, refs) => chunk('INST', [...u32(id), ...str(name), 0, ...u32(refs.length), ...encRefs(refs)]);
export const prop = (id, name, type, body, compress = false) => chunk('PROP', [...u32(id), ...str(name), type, ...body], compress);
export const prnt = (kids, pars) => chunk('PRNT', [0, ...u32(kids.length), ...encRefs(kids), ...encRefs(pars)]);
