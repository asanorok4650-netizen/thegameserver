// ルーム作成の回数制限(D1)。同じネットワーク(IP)からは「同時に1ルーム」「ルームが終わってから2分あける」。
// IPそのものは保存せず、ハッシュだけを D1 の room_limits に置く。管理用の合言葉つきのリクエストは制限しない(worker/index.js)。
export const ROOM_CREATE_COOLDOWN_MS = 2 * 60 * 1000;

export async function hashIp(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tgw-room:' + ip));
  return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 枠を取る(同時1ルーム + クールダウン明け)。取れたら true */
export async function claimSlot(env, ipHash, code, now = Date.now()) {
  const res = await env.DB.prepare(
    `INSERT INTO room_limits (ip_hash, active_room, last_closed_at) VALUES (?, ?, 0)
     ON CONFLICT(ip_hash) DO UPDATE SET active_room = excluded.active_room
     WHERE room_limits.active_room IS NULL AND room_limits.last_closed_at <= ?`
  ).bind(ipHash, code, now - ROOM_CREATE_COOLDOWN_MS).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getSlot(env, ipHash) {
  return env.DB.prepare('SELECT active_room, last_closed_at FROM room_limits WHERE ip_hash = ?').bind(ipHash).first();
}

/** 枠を返す。closedAt を渡すと、その時刻からクールダウンが始まる(null なら始めない) */
export async function releaseSlot(env, ipHash, code, closedAt) {
  if (!env.DB || !ipHash || !code) return;
  try {
    await env.DB.prepare('UPDATE room_limits SET active_room = NULL, last_closed_at = COALESCE(?, last_closed_at) WHERE ip_hash = ? AND active_room = ?')
      .bind(closedAt ?? null, ipHash, code).run();
  } catch (e) { /* 表が無い等。制限が効かないだけで、ゲームは止めない */ }
}

/**
 * 作成できるか。できれば null、だめなら { error, retryAfter? }。
 * isAlive(code): 記録上のルームがまだ生きているか(DO側が落ちて枠が残った場合に備えて確認する)
 */
export async function acquireSlot(env, ipHash, code, isAlive, now = Date.now()) {
  for (let i = 0; i < 2; i++) {
    if (await claimSlot(env, ipHash, code, now)) return null;
    const row = await getSlot(env, ipHash);
    if (row && row.active_room) {
      if (await isAlive(row.active_room)) return { error: 'room_active' };
      await releaseSlot(env, ipHash, row.active_room, null); // 残っていただけの枠を片付けて、もう一度
      continue;
    }
    const wait = ((row && row.last_closed_at) || 0) + ROOM_CREATE_COOLDOWN_MS - now;
    return { error: 'cooldown', retryAfter: Math.max(1, Math.ceil(wait / 1000)) };
  }
  return { error: 'busy' };
}
