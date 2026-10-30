// Roblox バイナリモデル形式(rbxm / rbxl の中身)のパーサ。THREE非依存。
// 対応: INST / PROP / PRNT チャンク、LZ4圧縮。Content(0x22)・Int64・SecurityCapabilities・Font・OptionalCFrame など。未対応のプロパティ型は無視して warnings に記録する。
// 未対応: ZSTD圧縮チャンク、XML形式(rbxmx)。
import { lz4Decompress } from './lz4.js';

const SIGNATURE = '<roblox!';
const utf8 = new TextDecoder('utf-8');

// CFrameの回転ID → 3x3行列(行優先)。id=0 の場合は9個のfloatが直接入っている。
const ROT = {
  0x02: [1, 0, 0, 0, 1, 0, 0, 0, 1], 0x03: [1, 0, 0, 0, 0, -1, 0, 1, 0], 0x05: [1, 0, 0, 0, -1, 0, 0, 0, -1],
  0x06: [1, 0, 0, 0, 0, 1, 0, -1, 0], 0x07: [0, 1, 0, 1, 0, 0, 0, 0, -1], 0x09: [0, 0, 1, 1, 0, 0, 0, 1, 0],
  0x0a: [0, -1, 0, 1, 0, 0, 0, 0, 1], 0x0c: [0, 0, -1, 1, 0, 0, 0, -1, 0], 0x0d: [0, 1, 0, 0, 0, 1, 1, 0, 0],
  0x0e: [0, 0, -1, 0, 1, 0, 1, 0, 0], 0x10: [0, -1, 0, 0, 0, -1, 1, 0, 0], 0x11: [0, 0, 1, 0, -1, 0, 1, 0, 0],
  0x14: [-1, 0, 0, 0, 1, 0, 0, 0, -1], 0x15: [-1, 0, 0, 0, 0, 1, 0, 1, 0], 0x17: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  0x18: [-1, 0, 0, 0, 0, -1, 0, -1, 0], 0x19: [0, 1, 0, -1, 0, 0, 0, 0, 1], 0x1b: [0, 0, -1, -1, 0, 0, 0, 1, 0],
  0x1c: [0, -1, 0, -1, 0, 0, 0, 0, -1], 0x1e: [0, 0, 1, -1, 0, 0, 0, -1, 0], 0x1f: [0, 1, 0, 0, 0, -1, -1, 0, 0],
  0x20: [0, 0, 1, 0, 1, 0, -1, 0, 0], 0x22: [0, -1, 0, 0, 0, 1, -1, 0, 0], 0x23: [0, 0, -1, 0, -1, 0, -1, 0, 0],
};

class Cur {
  constructor(u8) { this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = 0; this._t = new DataView(new ArrayBuffer(4)); }
  byte() { return this.u8[this.p++]; }
  u32() { const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  rawF32() { const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
  str() { const n = this.u32(); const s = utf8.decode(this.u8.subarray(this.p, this.p + n)); this.p += n; return s; }
  // バイト並べ替え(インターリーブ)された32bit値
  u32s(n) {
    const out = new Uint32Array(n), u = this.u8, b = this.p;
    for (let i = 0; i < n; i++) out[i] = ((u[b + i] << 24) | (u[b + n + i] << 16) | (u[b + 2 * n + i] << 8) | u[b + 3 * n + i]) >>> 0;
    this.p += n * 4;
    return out;
  }
  i32s(n) { const a = this.u32s(n), out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = (a[i] >>> 1) ^ -(a[i] & 1); return out; }
  f32s(n) {
    const a = this.u32s(n), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { this._t.setUint32(0, ((a[i] >>> 1) | (a[i] << 31)) >>> 0); out[i] = this._t.getFloat32(0); }
    return out;
  }
  // バイト並べ替えされた64bit値(ビッグエンディアン+ジグザグ変換)→ Number
  i64s(n) {
    const out = new Array(n), u = this.u8, b = this.p;
    for (let i = 0; i < n; i++) {
      let v = 0n;
      for (let k = 0; k < 8; k++) v = (v << 8n) | BigInt(u[b + k * n + i]);
      out[i] = Number((v >> 1n) ^ -(v & 1n));
    }
    this.p += n * 8;
    return out;
  }
  refs(n) { const a = this.i32s(n), out = new Int32Array(n); let acc = 0; for (let i = 0; i < n; i++) { acc += a[i]; out[i] = acc; } return out; }
}

export function isBinaryRbxm(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return u8.length >= 32 && String.fromCharCode(...u8.subarray(0, 8)) === SIGNATURE;
}

function readProp(cur, type, n, warnings, label) {
  const out = new Array(n);
  switch (type) {
    case 0x01: case 0x1d: for (let i = 0; i < n; i++) out[i] = cur.str(); return out; // String / Bytecode
    case 0x02: for (let i = 0; i < n; i++) out[i] = cur.byte() !== 0; return out;
    case 0x03: return Array.from(cur.i32s(n));
    case 0x04: return Array.from(cur.f32s(n));
    case 0x05: for (let i = 0; i < n; i++) { out[i] = cur.dv.getFloat64(cur.p, true); cur.p += 8; } return out;
    case 0x06: { const s = cur.f32s(n), o = cur.i32s(n); for (let i = 0; i < n; i++) out[i] = { scale: s[i], offset: o[i] }; return out; }
    case 0x07: { const sx = cur.f32s(n), sy = cur.f32s(n), ox = cur.i32s(n), oy = cur.i32s(n);
      for (let i = 0; i < n; i++) out[i] = { x: { scale: sx[i], offset: ox[i] }, y: { scale: sy[i], offset: oy[i] } }; return out; }
    case 0x0b: return Array.from(cur.u32s(n));
    case 0x0c: { const r = cur.f32s(n), g = cur.f32s(n), b = cur.f32s(n); for (let i = 0; i < n; i++) out[i] = [r[i], g[i], b[i]]; return out; }
    case 0x0d: { const x = cur.f32s(n), y = cur.f32s(n); for (let i = 0; i < n; i++) out[i] = [x[i], y[i]]; return out; }
    case 0x0e: { const x = cur.f32s(n), y = cur.f32s(n), z = cur.f32s(n); for (let i = 0; i < n; i++) out[i] = [x[i], y[i], z[i]]; return out; }
    case 0x10: {
      const rots = [];
      for (let i = 0; i < n; i++) {
        const id = cur.byte();
        if (id === 0) { const m = []; for (let k = 0; k < 9; k++) m.push(cur.rawF32()); rots.push(m); }
        else if (ROT[id]) rots.push(ROT[id].slice());
        else throw new Error(`未知のCFrame回転ID 0x${id.toString(16)}`);
      }
      const x = cur.f32s(n), y = cur.f32s(n), z = cur.f32s(n);
      for (let i = 0; i < n; i++) out[i] = { pos: [x[i], y[i], z[i]], rot: rots[i] };
      return out;
    }
    case 0x12: return Array.from(cur.u32s(n)); // Enum
    case 0x13: return Array.from(cur.refs(n)); // Instance参照
    case 0x1a: { const r = [], g = [], b = []; for (let i = 0; i < n; i++) r.push(cur.byte()); for (let i = 0; i < n; i++) g.push(cur.byte());
      for (let i = 0; i < n; i++) b.push(cur.byte()); for (let i = 0; i < n; i++) out[i] = [r[i], g[i], b[i]]; return out; }
    case 0x1b: case 0x21: return cur.i64s(n); // Int64 / SecurityCapabilities(Capabilities プロパティ。描画には無関係)
    case 0x1c: return Array.from(cur.u32s(n), (i) => ({ shared: i })); // SharedString(SSTRの添字のみ保持)
    case 0x1e: { // OptionalCFrame: CFrame型ID + CFrame配列 + Bool型ID + 有無の配列
      if (cur.byte() !== 0x10) throw new Error('OptionalCFrameの形式が不正です');
      const cfs = readProp(cur, 0x10, n, warnings, label);
      cur.byte();
      const has = []; for (let i = 0; i < n; i++) has.push(cur.byte() !== 0);
      return cfs.map((c, i) => (has[i] ? c : null));
    }
    case 0x1f: cur.p += 16 * n; return out.fill(null); // UniqueId(読み飛ばし)
    case 0x20: for (let i = 0; i < n; i++) { // Font
      const family = cur.str(); const weight = cur.dv.getUint16(cur.p, true); cur.p += 2; const style = cur.byte(); cur.str();
      out[i] = { family, weight, style };
    } return out;
    case 0x22: { // Content(新形式): MeshContent / TextureContent など。URIだけ取り出す
      const kinds = cur.i32s(n);
      const uriCount = cur.u32(), uris = [];
      for (let i = 0; i < uriCount; i++) uris.push(cur.str());
      let k = 0;
      for (let i = 0; i < n; i++) out[i] = kinds[i] === 1 ? (uris[k++] ?? null) : null; // 0=なし 1=URI 2=Object(未対応)
      return out;
    }
    default:
      warnings.push(`${label}: 未対応のプロパティ型 0x${type.toString(16)}`);
      return null;
  }
}

/**
 * @returns { instances: Map<ref, {ref,className,props,children,parent}>, roots: [], warnings: [] }
 */
export function parseRbxm(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isBinaryRbxm(u8)) throw new Error('バイナリrbxm形式ではありません');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const classes = new Map(); // classId -> { name, refs }
  const instances = new Map();
  const warnings = [];
  let p = 32;

  while (p + 16 <= u8.length) {
    const tag = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    const compLen = dv.getUint32(p + 4, true), rawLen = dv.getUint32(p + 8, true);
    p += 16;
    let data;
    if (compLen === 0) { data = u8.subarray(p, p + rawLen); p += rawLen; }
    else {
      const comp = u8.subarray(p, p + compLen); p += compLen;
      if (comp[0] === 0x28 && comp[1] === 0xb5 && comp[2] === 0x2f && comp[3] === 0xfd) {
        throw new Error('ZSTD圧縮のrbxmは未対応です');
      }
      data = lz4Decompress(comp, rawLen);
    }
    if (tag === 'END\0') break;
    const cur = new Cur(data);

    if (tag === 'INST') {
      const id = cur.u32(), name = cur.str(), hasService = cur.byte(), count = cur.u32();
      const refs = cur.refs(count);
      const cls = { name, refs: Array.from(refs) };
      classes.set(id, cls);
      for (const r of cls.refs) instances.set(r, { ref: r, className: name, props: {}, children: [], parent: null });
      void hasService;
    } else if (tag === 'PROP') {
      const id = cur.u32(), propName = cur.str(), type = cur.byte();
      const cls = classes.get(id);
      if (!cls) { warnings.push(`PROP: 未知のクラスID ${id}`); continue; }
      let vals;
      try { vals = readProp(cur, type, cls.refs.length, warnings, `${cls.name}.${propName}`); }
      catch (e) { warnings.push(`${cls.name}.${propName}: ${e.message}`); continue; }
      if (vals) for (let i = 0; i < cls.refs.length; i++) instances.get(cls.refs[i]).props[propName] = vals[i];
    } else if (tag === 'PRNT') {
      cur.byte();
      const count = cur.u32();
      const kids = cur.refs(count), pars = cur.refs(count);
      for (let i = 0; i < count; i++) {
        const c = instances.get(kids[i]);
        if (!c) continue;
        const par = pars[i] === -1 ? null : instances.get(pars[i]) || null;
        c.parent = par;
        if (par) par.children.push(c);
      }
    }
    // META / SSTR は今のところ不要
  }
  const roots = [...instances.values()].filter((i) => !i.parent);
  return { instances, roots, warnings };
}

export const nameOf = (inst) => (inst.props.Name !== undefined ? inst.props.Name : inst.className);
