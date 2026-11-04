// RBXL Player サーバーAPI(Cloudflare Worker)
//   GET    /api/health             接続確認(D1/R2/合言葉の設定状況)
//   GET    /api/servers            一覧(公開)
//   GET    /api/servers/:id/file   rbxl本体(公開)
//   POST   /api/servers?name=&description=&format=   追加(要合言葉。ボディにファイルそのもの)
//   PUT    /api/servers/:id?name=&description=&format=  同じidのまま差し替え(要合言葉。Studioの上書き公開用)
//   DELETE /api/servers/:id        削除(要合言葉)
//   POST   /api/rooms              マルチプレイのルーム作成(body: {serverId})→ {roomId(6文字のコード)}
//                                  同じIPから「同時に1ルーム」「終了後2分あける」(429 room_active / cooldown。合言葉つきなら制限なし)
//   GET    /api/rooms/:code/info   ルームの情報 {serverId, status, players, max}
//   GET    /api/rooms/:code/ws     WebSocket(シグナリングと世界時刻の基準だけ。ゲームのデータは流さない。ホストはいない)
//                                  切れたあとの再接続は &id=<hello で教えた自分のid>&token=<hello で渡した token>
// format は rbxl / rbxlx / tgw(.tgw はZIP。Workerは展開せず、R2に置いて配信するだけ)。
// 合言葉は Authorization: Bearer <ADMIN_PASSPHRASE> で送る。

import { hashIp, acquireSlot, releaseSlot } from './room-limit.js';

const MAX_BYTES = 100 * 1024 * 1024; // Workersのリクエスト上限(無料/Proプラン)に合わせる
const FORMATS = ['rbxl', 'rbxlx', 'tgw'];

// ── マルチプレイ(ホストレスP2P)。DOは参加者の名簿・WebRTCのシグナリング・世界時刻の基準だけを扱う ──
const ROOM_MAX = 8;
const ROOM_TTL_MS = 60 * 60 * 1000;      // 参加者がいなければ1時間で片付ける
const UNUSED_ROOM_MS = 60 * 1000;        // 作ったのに誰も来ないRoomは1分で片付ける
const EMPTY_GRACE_MS = 45 * 1000;        // 全員のWebSocketが切れても、この間は再接続を待つ(P2Pは続いている)
const MAX_SIGNAL_CHARS = 16384;          // シグナリング1メッセージの上限(SDP/ICE)
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32文字(I・Oなし)
function newRoomCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join('');
}
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(16)));
function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  const list = (env.ALLOWED_ORIGIN || '*').split(',').map((x) => x.trim()).filter(Boolean);
  return !origin || list.includes('*') || list.includes(origin); // ブラウザ以外はOriginを付けない(これだけで完全な保護にはならない)
}
async function roomAlive(env, code) {
  try {
    const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/info');
    return res.ok && (await res.json()).status !== 'closed';
  } catch (e) { return false; }
}
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Player';

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = list.includes('*') ? '*' : (list.includes(origin) ? origin : list[0] || '');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

// 合言葉の比較(長さが漏れないようSHA-256にしてから定数時間で比較)
async function isAdmin(request, env) {
  if (!env.ADMIN_PASSPHRASE) return false;
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.ADMIN_PASSPHRASE))
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const h = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      if (path === '/api/health' && request.method === 'GET') {
        let db = false, count = null;
        try { count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM servers').first()).n; db = true; } catch { /* 未初期化 */ }
        let roomLimit = false;
        try { await env.DB.prepare('SELECT 1 FROM room_limits LIMIT 1').first(); roomLimit = true; } catch { /* schema.sql の room_limits が未作成 */ }
        return json({ ok: true, db, r2: !!env.BUCKET, hasAdmin: !!env.ADMIN_PASSPHRASE, count, room: !!env.ROOM, roomLimit }, 200, h);
      }

      if (path === '/api/rooms' && request.method === 'POST') {
        if (!env.ROOM) return json({ error: 'room_not_configured' }, 501, h);
        const body = await request.json().catch(() => null);
        const serverId = body && typeof body.serverId === 'string' ? body.serverId : '';
        if (!/^[0-9a-f-]{36}$/.test(serverId)) return json({ error: 'bad_server' }, 400, h);
        if (!(await env.DB.prepare('SELECT id FROM servers WHERE id = ?').bind(serverId).first())) return json({ error: 'not_found' }, 404, h);
        // 作成の回数制限: 同じIPから同時に1ルーム、終了後2分あける。管理用の合言葉つきなら制限しない。
        // room_limits が未作成なら制限なしで動く(/api/health の roomLimit が false になる)
        const code = newRoomCode();
        const ipHash = await hashIp(request);
        let limited = false;
        if (!(await isAdmin(request, env))) {
          try {
            const verdict = await acquireSlot(env, ipHash, code, (c) => roomAlive(env, c));
            if (verdict) {
              const headers = verdict.retryAfter ? { ...h, 'Retry-After': String(verdict.retryAfter) } : h;
              return json(verdict, verdict.error === 'busy' ? 503 : 429, headers);
            }
            limited = true;
          } catch (e) { console.warn('room_limits unavailable: ' + String((e && e.message) || e)); }
        }
        const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', {
          method: 'POST',
          body: JSON.stringify({ serverId, code, ipHash: limited ? ipHash : '' })
        });
        if (!res.ok) {
          if (limited) await releaseSlot(env, ipHash, code, null);
          return json({ error: 'busy' }, 503, h);
        }
        return json({ roomId: code }, 201, h);
      }

      const rm = path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(ws|info)$/);
      if (rm) {
        if (!env.ROOM) return json({ error: 'room_not_configured' }, 501, h);
        const stub = env.ROOM.get(env.ROOM.idFromName(rm[1]));
        if (rm[2] === 'ws') {
          if (!originAllowed(request, env)) return new Response('forbidden', { status: 403 });
          return stub.fetch(request);
        }
        if (request.method === 'GET') {
          const res = await stub.fetch('https://room/info');
          return new Response(res.body, { status: res.status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
      }

      if (path === '/api/servers' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, name, description, format, size, created_at AS createdAt FROM servers ORDER BY created_at DESC'
        ).all();
        return json({ servers: results }, 200, h);
      }

      if (path === '/api/servers' && request.method === 'POST') {
        if (!(await isAdmin(request, env))) return json({ error: 'unauthorized' }, 401, h);
        const name = (url.searchParams.get('name') || '').trim().slice(0, 80);
        const description = (url.searchParams.get('description') || '').trim().slice(0, 300);
        const format = (url.searchParams.get('format') || '').toLowerCase();
        const size = Number(request.headers.get('Content-Length'));
        if (!name) return json({ error: 'name_required' }, 400, h);
        if (!FORMATS.includes(format)) return json({ error: 'bad_format' }, 400, h);
        if (!request.body || !Number.isFinite(size) || size <= 0) return json({ error: 'file_required' }, 400, h);
        if (size > MAX_BYTES) return json({ error: 'too_large', maxBytes: MAX_BYTES }, 413, h);

        const id = crypto.randomUUID();
        const key = `servers/${id}.${format}`;
        await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
        const createdAt = new Date().toISOString();
        try {
          await env.DB.prepare(
            'INSERT INTO servers (id, name, description, format, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(id, name, description, format, size, key, createdAt).run();
        } catch (e) {
          await env.BUCKET.delete(key); // 一覧に載らないファイルを残さない
          throw e;
        }
        return json({ server: { id, name, description, format, size, createdAt } }, 201, h);
      }

      const m = path.match(/^\/api\/servers\/([0-9a-f-]{36})(\/file)?$/);
      if (m) {
        const id = m[1];
        const row = await env.DB.prepare('SELECT r2_key, size, created_at AS createdAt FROM servers WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'not_found' }, 404, h);

        if (m[2] && request.method === 'GET') {
          const obj = await env.BUCKET.get(row.r2_key);
          if (!obj) return json({ error: 'file_missing' }, 404, h);
          return new Response(obj.body, {
            headers: {
              ...h,
              'Content-Type': 'application/octet-stream',
              'Content-Length': String(obj.size),
              ETag: obj.httpEtag,
              'Cache-Control': 'public, max-age=300'
            }
          });
        }

        if (!m[2] && request.method === 'PUT') {
          if (!(await isAdmin(request, env))) return json({ error: 'unauthorized' }, 401, h);
          const name = (url.searchParams.get('name') || '').trim().slice(0, 80);
          const description = (url.searchParams.get('description') || '').trim().slice(0, 300);
          const format = (url.searchParams.get('format') || '').toLowerCase();
          const size = Number(request.headers.get('Content-Length'));
          if (!name) return json({ error: 'name_required' }, 400, h);
          if (!FORMATS.includes(format)) return json({ error: 'bad_format' }, 400, h);
          if (!request.body || !Number.isFinite(size) || size <= 0) return json({ error: 'file_required' }, 400, h);
          if (size > MAX_BYTES) return json({ error: 'too_large', maxBytes: MAX_BYTES }, 413, h);

          // 新しいファイルを置いてから一覧を更新する(途中で失敗しても、一覧から開けないファイルにはならない)
          const key = `servers/${id}.${format}`;
          await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
          await env.DB.prepare('UPDATE servers SET name = ?, description = ?, format = ?, size = ?, r2_key = ? WHERE id = ?')
            .bind(name, description, format, size, key, id).run();
          if (row.r2_key !== key) await env.BUCKET.delete(row.r2_key); // 形式が変わった時だけ古いキーを消す
          return json({ server: { id, name, description, format, size, createdAt: row.createdAt } }, 200, h);
        }

        if (!m[2] && request.method === 'DELETE') {
          if (!(await isAdmin(request, env))) return json({ error: 'unauthorized' }, 401, h);
          await env.BUCKET.delete(row.r2_key);
          await env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(id).run();
          return json({ ok: true }, 200, h);
        }
      }

      return json({ error: 'not_found' }, 404, h);
    } catch (e) {
      return json({ error: 'internal', message: String((e && e.message) || e) }, 500, h);
    }
  }
};

// 1 Room = 1 Durable Object。WebSocketは参加・退出の通知とSDP/ICEの中継、世界時刻の基準だけに使う(Hibernation APIなので待機中は課金されにくい)。
// 位置などのゲームデータはWebRTC DataChannelで直接やり取りし、ここは通さない。ホストはいない(全員が対等)。
// 状態: waiting(まだ誰も来ていない。1分で破棄) → running(誰かが入った) → 全員のWebSocketが切れて猶予(45秒)を過ぎたら破棄
// 参加者は参加順の連番で 'p1' 'p2' … のidを受け取り、再接続用の token(Room側には sha256 だけを保存)も受け取る。
// P2Pの接続は「先に入った人が、後から入った人へofferを出す」ので、Room は peer-join を既存の全員へ送る。
export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  _byId(id) { return this.ctx.getWebSockets().find((ws) => ws.deserializeAttachment()?.id === id); }
  _res(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
  _live() { return this.ctx.getWebSockets().filter((ws) => { const a = ws.deserializeAttachment(); return a && !a.replaced; }); }
  _members(exceptId) { // 参加順(idの連番)に並べる
    return this._live().map((ws) => ws.deserializeAttachment()).filter((a) => a.id !== exceptId).map((a) => ({ id: a.id, name: a.name }))
      .sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)));
  }
  _broadcast(msg, exceptId) {
    const text = JSON.stringify(msg);
    for (const ws of this._live()) if (ws.deserializeAttachment().id !== exceptId) { try { ws.send(text); } catch (e) { /* 閉じ済み */ } }
  }

  async fetch(request) {
    const st = this.ctx.storage;
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      if (await st.get('serverId')) return this._res({ error: 'exists' }, 409);
      const b = await request.json();
      await st.put({ serverId: b.serverId, code: b.code || '', ipHash: b.ipHash || '', status: 'waiting', createdAt: Date.now(), seq: 0 });
      await st.setAlarm(Date.now() + UNUSED_ROOM_MS); // 誰も来なければ片付ける
      return this._res({ ok: true });
    }
    const serverId = await st.get('serverId');
    if (!serverId) return this._res({ error: 'not_found' }, 404);
    const status = await st.get('status');

    if (url.pathname.endsWith('/info')) {
      return this._res({ serverId, status, players: this._live().length, max: ROOM_MAX });
    }

    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const resumeId = url.searchParams.get('id');
      if (resumeId) return this._acceptResume(url, st, resumeId);
      if (this._live().length >= ROOM_MAX) return new Response('full', { status: 409 });
      const seq = ((await st.get('seq')) || 0) + 1;
      const id = 'p' + seq;
      const name = cleanName(url.searchParams.get('name'));
      const token = randomToken();
      const peers = this._members(id);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ id, name });
      await st.put({ seq, status: 'running', ['m:' + id]: { h: await sha256hex(token), name } });
      await st.setAlarm(Date.now() + ROOM_TTL_MS);
      server.send(JSON.stringify({ t: 'hello', id, token, peers, max: ROOM_MAX, resumed: false }));
      this._broadcast({ t: 'peer-join', id, name }, id);
      return new Response(null, { status: 101, webSocket: client });
    }
    return this._res({ error: 'not_found' }, 404);
  }

  // 切れたあとの再接続: hello で渡した token を持っている本人だけ。P2Pは続いているので、peer-join は送らない
  async _acceptResume(url, st, id) {
    const token = url.searchParams.get('token') || '';
    const rec = /^p\d{1,9}$/.test(id) ? await st.get('m:' + id) : null;
    if (!rec || !token || (await sha256hex(token)) !== rec.h) return new Response('forbidden', { status: 403 });
    // 切れたことにまだ気づいていない古い接続があれば入れ替える(そのcloseは退出として扱わない)
    const old = this._byId(id);
    if (old) { try { old.serializeAttachment({ ...old.deserializeAttachment(), replaced: true }); old.close(4000, 'replaced'); } catch (e) { /* 閉じ済み */ } }
    else if (this._live().length >= ROOM_MAX) return new Response('full', { status: 409 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name: rec.name });
    await st.put('status', 'running');
    await st.setAlarm(Date.now() + ROOM_TTL_MS);
    server.send(JSON.stringify({ t: 'hello', id, peers: this._members(id), max: ROOM_MAX, resumed: true }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // 受け付けるのは、SDP/ICEの中継(参加者どうし)と、世界時刻の問い合わせだけ
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_SIGNAL_CHARS) return;
    let m; try { m = JSON.parse(message); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const me = ws.deserializeAttachment();
    if (!me || me.replaced) return;
    if (m.t === 'time') {
      // 世界時刻 = Room を作ってからの経過秒。参加者が往復時間から自分の時計とのずれを計算する
      if (typeof m.c !== 'number' || !Number.isFinite(m.c)) return;
      const created = (await this.ctx.storage.get('createdAt')) || Date.now();
      try { ws.send(JSON.stringify({ t: 'time', c: m.c, s: (Date.now() - created) / 1000 })); } catch (e) { /* 閉じ済み */ }
      return;
    }
    if (m.t !== 'signal' || typeof m.to !== 'string' || m.to === me.id) return;
    const target = this._byId(m.to);
    if (!target || target.deserializeAttachment()?.replaced) return;
    try { target.send(JSON.stringify({ t: 'signal', from: me.id, data: m.data })); } catch (e) { /* 閉じ済み */ }
  }

  async webSocketClose(ws, code) {
    const me = ws.deserializeAttachment();
    try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, 'closed'); } catch (e) { /* 閉じ済み */ }
    if (!me || me.replaced) return;
    this._broadcast({ t: 'peer-leave', id: me.id }, me.id); // P2P未成立の後始末用(成立済みの相手はP2P側で切れを検出する)
    // 全員いなくなったら、猶予のあいだ再接続を待つ(P2Pは続いていて、みんなが一斉に切れただけかもしれない)
    if (this._members(me.id).length === 0 && (await this.ctx.storage.get('status')) === 'running') {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_GRACE_MS);
    }
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }

  async _release(cooldown) {
    const st = this.ctx.storage;
    await releaseSlot(this.env, await st.get('ipHash'), await st.get('code'), cooldown ? Date.now() : null);
  }

  // 期限切れ・誰も来なかった・全員が戻らなかったRoomを片付ける(ゲームループや生存監視には使わない)
  async alarm() {
    const st = this.ctx.storage;
    const status = await st.get('status');
    if (status === 'waiting') { await this._release(false); await st.deleteAll(); return; } // 誰も来なかった(クールダウンなし)
    if (this._live().length === 0) { await this._release(true); await st.deleteAll(); return; }
    await st.setAlarm(Date.now() + ROOM_TTL_MS);
  }
}
