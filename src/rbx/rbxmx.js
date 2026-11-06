// Roblox XML形式モデル(rbxmx / rbxlx)のパーサ。THREE非依存。
// parseRbxm(バイナリ)と同じ形 { instances, roots, warnings } のツリーを返すので、extractAccessory などをそのまま使える。
// 対応: Item/Properties、string・数値・bool・token・Vector2/3・CFrame・Color3/Color3uint8・Content(url/uri)・UDim/UDim2・Font・Ref ほか。
// 未対応のプロパティ型は無視して warnings に記録する。

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ENTITY = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function isXmlRbxm(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = new TextDecoder('utf-8').decode(u8.subarray(0, 1024)).replace(/^\uFEFF/, '');
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<roblox[\s>]/.test(head); // バイナリは "<roblox!" なので一致しない
}

function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (_) { return m; }
    }
    return ENTITY[e] !== undefined ? ENTITY[e] : m;
  });
}

// 最小限のXMLパーサ(DOMParserはNodeテストで使えないため自前)。node = { tag, attrs, kids, text }
function parseXml(s) {
  const root = { tag: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    const cur = stack[stack.length - 1];
    if (lt < 0) break;
    if (lt > i) cur.text += decode(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      cur.text += s.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    const c1 = s[lt + 1];
    if (c1 === '?' || c1 === '!') { const e = s.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }
    if (c1 === '/') { const e = s.indexOf('>', lt + 2); if (stack.length > 1) stack.pop(); i = e < 0 ? n : e + 1; continue; }
    let j = lt + 1, q = '';
    while (j < n) {
      const c = s[j];
      if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      j++;
    }
    let body = s.slice(lt + 1, j);
    const self = body.endsWith('/');
    if (self) body = body.slice(0, -1);
    const m = /^[^\s/>]+/.exec(body);
    if (!m) { i = j + 1; continue; }
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    const rest = body.slice(m[0].length);
    while ((a = re.exec(rest))) attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
    const node = { tag: m[0], attrs, kids: [], text: '' };
    cur.kids.push(node);
    if (!self) stack.push(node);
    i = j + 1;
  }
  return root;
}

const num = (s) => {
  const t = String(s).trim();
  if (t === 'INF') return Infinity;
  if (t === '-INF') return -Infinity;
  const v = Number(t);
  return Number.isNaN(v) ? 0 : v;
};
const kid = (node, tag) => node.kids.find((c) => c.tag === tag);
const field = (node, tag, def = 0) => { const k = kid(node, tag); return k ? num(k.text) : def; };
const unpack = (v) => [(v >>> 16) & 255, (v >>> 8) & 255, v & 255]; // 0xAARRGGBB → [r,g,b] (0〜255)

function readCFrame(node) {
  const rot = IDENT.map((d, i) => field(node, `R${(i / 3) | 0}${i % 3}`, d));
  return { pos: [field(node, 'X'), field(node, 'Y'), field(node, 'Z')], rot };
}

/** 1プロパティ要素 → 値。未対応の型は undefined を返す。 */
function readValue(p) {
  const t = p.tag;
  switch (t) {
    case 'string': case 'ProtectedString': case 'BinaryString': return p.text;
    case 'bool': return p.text.trim() === 'true';
    case 'int': case 'int64': case 'float': case 'double': case 'token': case 'SecurityCapabilities': return num(p.text);
    case 'Vector2': return [field(p, 'X'), field(p, 'Y')];
    case 'Vector3': return [field(p, 'X'), field(p, 'Y'), field(p, 'Z')];
    case 'CoordinateFrame': case 'CFrame': return readCFrame(p);
    case 'OptionalCoordinateFrame': { const cf = kid(p, 'CFrame') || kid(p, 'CoordinateFrame'); return cf ? readCFrame(cf) : null; }
    case 'Color3uint8': return unpack(num(p.text));
    case 'Color3': return p.kids.length ? [field(p, 'R'), field(p, 'G'), field(p, 'B')] : unpack(num(p.text)).map((v) => v / 255); // 旧形式は uint32 のパック値
    case 'Content': case 'ContentId': {
      const k = kid(p, 'url') || kid(p, 'uri');
      const s = (k ? k.text : p.kids.length ? '' : p.text).trim();
      return s || null; // <null/> は null
    }
    case 'UDim': return { scale: field(p, 'S'), offset: field(p, 'O') };
    case 'UDim2': return { x: { scale: field(p, 'XS'), offset: field(p, 'XO') }, y: { scale: field(p, 'YS'), offset: field(p, 'YO') } };
    case 'Font': {
      const fam = kid(p, 'Family');
      const fk = fam && (kid(fam, 'url') || kid(fam, 'uri'));
      const st = kid(p, 'Style');
      return { family: ((fk ? fk.text : fam ? fam.text : '') || '').trim(), weight: field(p, 'Weight', 400), style: st && st.text.trim() === 'Italic' ? 1 : 0 };
    }
    case 'Ref': return p.text.trim(); // 後で参照IDへ解決する
    case 'SharedString': case 'UniqueId': return null;
    default: return undefined;
  }
}

/**
 * @returns { instances: Map<ref, {ref,className,props,children,parent}>, roots: [], warnings: [] }
 */
export function parseRbxmx(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const doc = parseXml(new TextDecoder('utf-8').decode(u8).replace(/^\uFEFF/, ''));
  const top = doc.kids.find((k) => k.tag === 'roblox');
  if (!top) throw new Error('XML形式のRobloxモデルではありません');

  const instances = new Map(), warnings = [], byReferent = new Map(), pendingRefs = [], warned = new Set();
  let next = 0;

  const readProps = (propsNode, inst) => {
    for (const p of propsNode.kids) {
      const name = p.attrs.name;
      if (!name) continue;
      const v = readValue(p);
      if (v === undefined) {
        const key = `${inst.className}.${name}`;
        if (!warned.has(key)) { warned.add(key); warnings.push(`${key}: 未対応のプロパティ型 ${p.tag}`); }
        continue;
      }
      inst.props[name] = v;
      if (p.tag === 'Ref') pendingRefs.push([inst, name, v]);
    }
    // 旧形式の別名を現行名に寄せる(バイナリ側と同じプロパティ名で読めるように)
    const pr = inst.props;
    if (pr.Size === undefined && pr.size !== undefined) pr.Size = pr.size;
    if (pr.MeshId === undefined && pr.MeshID !== undefined) pr.MeshId = pr.MeshID;
  };

  const build = (node, parent) => {
    const inst = { ref: next++, className: node.attrs.class || '?', props: {}, children: [], parent };
    instances.set(inst.ref, inst);
    if (node.attrs.referent) byReferent.set(node.attrs.referent, inst.ref);
    if (parent) parent.children.push(inst);
    for (const k of node.kids) if (k.tag === 'Properties') readProps(k, inst);
    for (const k of node.kids) if (k.tag === 'Item') build(k, inst);
  };
  for (const k of top.kids) if (k.tag === 'Item') build(k, null);

  for (const [inst, name, v] of pendingRefs) inst.props[name] = byReferent.has(v) ? byReferent.get(v) : -1;
  const roots = [...instances.values()].filter((i) => !i.parent);
  return { instances, roots, warnings };
}
