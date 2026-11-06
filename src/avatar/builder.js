  if (def.shape === 'head' && info.transparency < 0.99) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, w = bb.max.x - bb.min.x;
    let zFront = Infinity; // 顔の中心付近で一番手前の頂点に合わせる(曲面でも浮きにくい)
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i] - cx) < w * 0.2 && Math.abs(pos[i + 1] - cy) < w * 0.2) zFront = Math.min(zFront, pos[i + 2]);
    }
    if (!Number.isFinite(zFront)) zFront = bb.min.z;
    const fs = w * 0.62;
    // 頭部テクスチャに顔が含まれる場合、顔アセット未読込時の既定顔は重ねない。
    const faceCanvas = faceBitmap ? faceCanvasFrom(faceBitmap) : (info.texture ? null : defaultFaceCanvas());
    if (faceCanvas) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(fs, fs),
        new THREE.MeshBasicMaterial({ map: newTexture(faceCanvas),
          transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
      face.name = 'Face';
      face.rotation.y = Math.PI;
      face.position.set(cx, cy, zFront - 0.004);
      mesh.add(face);
    }
  }
