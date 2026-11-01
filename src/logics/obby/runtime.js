/** Obby専用の実行ルール。ゲームエンジンの詳細には依存せず、API経由で操作する。 */
export function createObbyRuntime(config, api) {
  const killY = Number.isFinite(config?.params?.killY) ? config.params.killY : -50;
  let cleared = false;

  function onContact({ tag, part }) {
    if (cleared) return;
    if (tag === 'kill') {
      api.respawn();
      return;
    }
    if (tag === 'checkpoint') {
      const half = part.half;
      const rot = part.rot;
      const topY = part.pos[1]
        + Math.abs(rot[3]) * half[0]
        + Math.abs(rot[4]) * half[1]
        + Math.abs(rot[5]) * half[2];
      api.setCheckpoint([part.pos[0], topY + 0.2, part.pos[2]]);
      return;
    }
    if (tag === 'goal') {
      cleared = true;
      api.complete();
    }
  }

  function update({ position }) {
    if (!cleared && position.y < killY) api.respawn();
  }

  function reset() {
    cleared = false;
  }

  return Object.freeze({ onContact, update, reset });
}
