// アバタープレビュー用の3Dステージ。Reactから生成・破棄される(dispose必須)。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONFIG } from '../config.js';
import { disposeObject } from './builder.js';

export class Stage {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:relative;width:100%;height:100%;touch-action:none';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(3.2, 4.2, -11);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b8, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(-4, 9, -6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 8, bottom: -3, near: 1, far: 30 });
    this.scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64),
      new THREE.MeshStandardMaterial({ color: 0xdfe4f2, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.55, 64),
      new THREE.MeshBasicMaterial({ color: 0x335cff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.target.set(0, 2.9, 0);
    this.autoRotate = true;
    this.controls.addEventListener('start', () => { this.autoRotate = false; });

    this.avatar = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  attachTo(container) {
    container.appendChild(this.el);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setAvatar(built) {
    if (this.avatar) { this.scene.remove(this.avatar.group); disposeObject(this.avatar.group); }
    this.avatar = built;
    this.scene.add(built.group);
    const height = built.box.max.y - built.box.min.y;
    this.controls.target.set(0, height * 0.52, 0);
    const dist = Math.max(8, height * 1.9);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.autoRotate = true;
  }

  tick() {
    if (this.autoRotate && this.avatar) this.avatar.group.rotation.y += 0.008;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** ページ離脱時に必ず呼ぶ(WebGLコンテキストとGPUメモリを解放) */
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.controls.dispose();
    if (this.avatar) { this.scene.remove(this.avatar.group); disposeObject(this.avatar.group); this.avatar = null; }
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.el.remove();
  }
}
