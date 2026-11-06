// バイナリ(rbxm/rbxl)とXML(rbxmx/rbxlx)を先頭バイトで判別し、同じ形のツリーにする。THREE非依存。
import { parseRbxm, isBinaryRbxm } from './rbxm.js';
import { parseRbxmx, isXmlRbxm } from './rbxmx.js';

/** 'binary' | 'xml' | null(判別不能) */
export function modelFormat(buf) {
  if (isBinaryRbxm(buf)) return 'binary';
  if (isXmlRbxm(buf)) return 'xml';
  return null;
}

export function parseModel(buf) {
  const f = modelFormat(buf);
  if (f === 'binary') return parseRbxm(buf);
  if (f === 'xml') return parseRbxmx(buf);
  throw new Error('rbxm / rbxmx として認識できない形式です');
}
