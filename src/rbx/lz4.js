// LZ4 ブロック形式の展開(rbxmのチャンク圧縮用)。
export function lz4Decompress(src, outSize) {
  const dst = new Uint8Array(outSize);
  let s = 0, d = 0;
  const n = src.length;
  while (s < n) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255 && s < n); }
    if (s + lit > n || d + lit > outSize) throw new Error('LZ4: リテラルが範囲外です');
    dst.set(src.subarray(s, s + lit), d);
    s += lit; d += lit;
    if (s >= n) break; // 最後のシーケンスはリテラルのみ
    const off = src[s] | (src[s + 1] << 8);
    s += 2;
    let ml = token & 15;
    if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255 && s < n); }
    ml += 4;
    let m = d - off;
    if (off === 0 || m < 0 || d + ml > outSize) throw new Error('LZ4: マッチが範囲外です');
    for (let i = 0; i < ml; i++) dst[d++] = dst[m++]; // 重なりコピーのため1バイトずつ
  }
  if (d !== outSize) throw new Error(`LZ4: 展開サイズ不一致 (${d} != ${outSize})`);
  return dst;
}
