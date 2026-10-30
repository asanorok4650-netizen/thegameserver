// version 7.00 メッシュの Draco ビットストリームを three の DRACOLoader でデコードする(ブラウザ専用)。
// デコーダ本体(draco_wasm_wrapper.js / draco_decoder.wasm)は public/draco/ に置いてある。
// Roblox の Draco ストリームの属性ID: 0=位置 1=法線 2=UV(3=タンジェント 4=頂点色は使わない)
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

let loader = null;

export async function dracoDecode(bytes) {
  if (!loader) {
    loader = new DRACOLoader();
    loader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    loader.setDecoderConfig({ type: 'wasm' });
  }
  const buf = bytes.slice().buffer; // デコード側へ転送(移譲)されるのでコピーを渡す
  const geo = await loader.decodeDracoFile(buf, (g) => g, { position: 0, normal: 1, uv: 2 },
    { position: 'Float32Array', normal: 'Float32Array', uv: 'Float32Array' }, undefined,
    (e) => { throw e; });
  if (!geo || !geo.attributes || !geo.attributes.position) throw new Error('Dracoのデコードに失敗しました');
  const a = geo.attributes;
  const out = { positions: a.position.array, normals: a.normal && a.normal.array, uvs: a.uv && a.uv.array,
    indices: geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: a.position.count }, (_, i) => i) };
  geo.dispose();
  return out;
}
