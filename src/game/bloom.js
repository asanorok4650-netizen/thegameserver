// Bloom(UnrealBloomPass)。素のレンダラーの代わりに EffectComposer で描く。
// 描画順: RenderPass(シーン) → UnrealBloomPass → OutputPass(トーンマッピング・色空間変換)
// CONFIG.bloom が false のときは作らない(null を返す)。呼び出し側は null なら従来どおり renderer.render を使う。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from '../config.js';

// Roblox の BloomEffect との対応: Intensity ≒ strength / Size ≒ radius / Threshold ≒ threshold
export const BLOOM_DEFAULTS = { strength: 0.35, radius: 0.4, threshold: 0.95 };

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function createBloom(renderer, scene, camera) {
  if (!CONFIG.bloom) return null;
  // composer の描画先にはアンチエイリアスが効かないので、MSAA(samples)付きのHalfFloatターゲットを渡す。
  // 大きさは最初の setSize で決まる
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  return {
    /** w,h は CSS ピクセル、pixelRatio はレンダラーと同じ値 */
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    /** { strength, radius, threshold }。範囲外・不正な値は既定値に戻す */
    setParams(p = {}) {
      bloomPass.strength = num(p.strength, 0, 3, BLOOM_DEFAULTS.strength);
      bloomPass.radius = num(p.radius, 0, 1, BLOOM_DEFAULTS.radius);
      bloomPass.threshold = num(p.threshold, 0, 5, BLOOM_DEFAULTS.threshold);
    },
    render(dt) { composer.render(dt); },
    dispose() {
      renderPass.dispose?.();
      bloomPass.dispose();
      outputPass.dispose();
      composer.dispose();
    }
  };
}
