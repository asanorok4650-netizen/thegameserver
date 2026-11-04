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
//   GET    /api/rooms/:code/ws     WebSocket(シグナリング専用。ゲームのデータは流さない。進行役は &authority=1)
// format は rbxl / rbxlx / tgw(.tgw はZIP。Workerは展開せず、R2に置いて配信するだけ)。
// 合言葉は Authorization: Bearer <ADMIN_PASSPHRASE> で送る。

import { hashIp, acquireSlot, releaseSlot } from './room-limit.js';

const MAX_BYTES = 100 * 1024 * 1024; // Workersのリクエスト上限(無料/Proプラン)に合わせる
const FORMATS = ['rbxl', 'rbxlx', 'tgw'];

// ── マルチプレイ(Hybrid P2P)。DOはRoomの状態とWebRTCのシグナリングだけを扱う ──
const ROOM_MAX = 8;
const RECONNECT_GRACE_MS = 30 * 1000;
function newResumeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function tokenHash(token) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

const ROOM_TTL_MS = 60 * 60 * 1000;      // 参加者がいなければ1時間で片付ける
const UNUSED_ROOM_MS = 60 * 1000;        // 作ったのにホストが来ないRoomは1分で片付ける
const ROOM_CLOSED_KEEP_MS = 60 * 1000;
const MAX_SIGNAL_CHARS = 16384;          // シグナリング1メッセージの上限(SDP/ICE)
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32文字(I・Oなし)
function newRoomCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join('');
}
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
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

// 1 Room = 1 Durable Object。DOはRoomの存続・メンバー管理とWebRTCシグナリングを担当する。
// Room作成者という所有者は存在しない。最初に接続したPeerがゲーム進行役(暫定Authority)になる。
// Authority退出後も他のPeerが残っていればRoomを維持する。Authorityの自動引き継ぎは後続段階で実装する。
export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  _byId(id) { return this.ctx.getWebSockets().find((ws) => ws.deserializeAttachment()?.id === id); }
  _res(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
  _broadcast(message, exceptId) {
    for (const ws of this.ctx.getWebSockets()) {
      const peer = ws.deserializeAttachment();
      if (peer && peer.id !== exceptId) { try { ws.send(JSON.stringify(message)); } catch { /* 接続終了中 */ } }
    }
  }
  async fetch(request) {
    const st = this.ctx.storage, url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      if (await st.get('serverId')) return this._res({ error: 'exists' }, 409);
      const b = await request.json();
      await st.put({ serverId: b.serverId, code: b.code || '', ipHash: b.ipHash || '', status: 'waiting', authorityId: '', members: {}, createdAt: Date.now() });
      await st.setAlarm(Date.now() + UNUSED_ROOM_MS);
      return this._res({ ok: true });
    }
    const serverId = await st.get('serverId');
    if (!serverId) return this._res({ error: 'not_found' }, 404);
    const status = await st.get('status');
    if (url.pathname.endsWith('/info')) {
      return this._res({ serverId, status, players: this.ctx.getWebSockets().length, max: ROOM_MAX, authorityAvailable: this.ctx.getWebSockets().some((ws) => ws.deserializeAttachment()?.authority) });
    }
    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (status === 'closed') return new Response('closed', { status: 410 });
      if (url.searchParams.get('resume')) return this._resumePeer(url, st);
      if (url.searchParams.get('authority') === '1') return this._acceptAuthority(url, st, status);
      if (status === 'waiting') return new Response('no_authority', { status: 409 });
      if (status === 'waiting-authority') return new Response('authority_unavailable', { status: 409 });
      if (status !== 'running') return new Response('closed', { status: 410 });
      if (Object.keys((await st.get('members')) || {}).length >= ROOM_MAX) return new Response('full', { status: 409 });
      const authorityId = await st.get('authorityId');
      const seq = ((await st.get('seq')) || 0) + 1, id = 'p' + seq, name = cleanName(url.searchParams.get('name'));
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const resumeToken = newResumeToken();
      server.serializeAttachment({ id, name, authority: false, resumeTokenHash: await tokenHash(resumeToken) });
      const members = (await st.get('members')) || {};
      members[id] = { id, name, authority: false, tokenHash: await tokenHash(resumeToken), deadline: 0 };
      await st.put({ seq, members });
      const peers = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()).filter((p) => p && p.id !== id).map((p) => ({ id: p.id, name: p.name }));
      server.send(JSON.stringify({ t: 'hello', id, host: false, authorityId, hostId: authorityId, max: ROOM_MAX, resumeToken, resumed: false, peers }));
      this._broadcast({ t: 'peer-join', id, name }, id);
      await st.setAlarm(Date.now() + ROOM_TTL_MS);
      return new Response(null, { status: 101, webSocket: client });
    }
    return this._res({ error: 'not_found' }, 404);
  }
  // Room作成者ではなく、最初に接続したPeerが暫定Simulation Authorityになる。
  async _acceptAuthority(url, st, status) {
    if (status !== 'waiting') return new Response('authority_exists', { status: 409 });
    if (await st.get('authorityId')) return new Response('authority_exists', { status: 409 });
    if (this.ctx.getWebSockets().length >= ROOM_MAX) return new Response('full', { status: 409 });
    const seq = ((await st.get('seq')) || 0) + 1, id = 'p' + seq, name = cleanName(url.searchParams.get('name'));
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const resumeToken = newResumeToken();
    server.serializeAttachment({ id, name, authority: true, resumeTokenHash: await tokenHash(resumeToken) });
    const members = (await st.get('members')) || {};
    members[id] = { id, name, authority: true, tokenHash: await tokenHash(resumeToken), deadline: 0 };
    await st.put({ status: 'running', authorityId: id, seq, members });
    await st.setAlarm(Date.now() + ROOM_TTL_MS);
    const peers = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()).filter((p) => p && p.id !== id).map((p) => ({ id: p.id, name: p.name }));
    server.send(JSON.stringify({ t: 'hello', id, host: true, authority: true, hostId: id, authorityId: id, max: ROOM_MAX, resumeToken, resumed: false, peers }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async _resumePeer(url, st) {
    const token = url.searchParams.get('resume') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) return new Response('invalid_resume', { status: 401 });
    const hash = await tokenHash(token), members = (await st.get('members')) || {};
    const member = Object.values(members).find((m) => m.tokenHash === hash);
    if (!member) return new Response('invalid_resume', { status: 401 });
    if (!member.deadline) return new Response('already_connected', { status: 409 });
    if (member.deadline < Date.now()) return new Response('resume_expired', { status: 410 });
    if (this._byId(member.id)) return new Response('already_connected', { status: 409 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: member.id, name: member.name, authority: member.authority, resumeTokenHash: hash });
    member.deadline = 0; members[member.id] = member;
    const active = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()).filter((p) => p && p.id !== member.id);
    await st.put({ members, ...(member.authority ? { status: 'running', authorityId: member.id } : {}) });
    const authorityId = await st.get('authorityId');
    server.send(JSON.stringify({ t: 'hello', id: member.id, name: member.name, authority: member.authority, host: member.authority, authorityId, hostId: authorityId, max: ROOM_MAX, resumeToken: token, resumed: true, peers: active.map((p) => ({ id: p.id, name: p.name })) }));
    if (member.authority) this._broadcast({ t: 'authority-resume', id: member.id, name: member.name }, member.id);
    else this._broadcast({ t: 'peer-resume', id: member.id, name: member.name }, member.id);
    await this._scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }
  async _scheduleAlarm() {
    const st = this.ctx.storage, members = (await st.get('members')) || {};
    const deadlines = Object.values(members).map((m) => m.deadline).filter((n) => n > 0);
    await st.setAlarm(deadlines.length ? Math.min(...deadlines) : Date.now() + ROOM_TTL_MS);
  }
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_SIGNAL_CHARS) return;
    let m; try { m = JSON.parse(message); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (m.t === 'leave') {
      ws.serializeAttachment({ ...me, intentional: true });
      const st = this.ctx.storage, members = (await st.get('members')) || {};
      delete members[me.id];
      if (me.authority && (await st.get('authorityId')) === me.id) {
        await st.put({ members, status: 'waiting-authority', authorityId: '' });
        this._broadcast({ t: 'authority-left', id: me.id });
      } else {
        await st.put('members', members);
        this._broadcast({ t: 'peer-leave', id: me.id }, me.id);
      }
      try { ws.close(1000, 'left'); } catch {}
      if (Object.keys(members).length === 0) await this._closeRoom(true);
      else await this._scheduleAlarm();
      return;
    }
    if (m.t !== 'signal' || typeof m.to !== 'string') return;
    const target = this._byId(m.to), other = target?.deserializeAttachment();
    if (!other || (!me.authority && !other.authority)) return;
    target.send(JSON.stringify({ t: 'signal', from: me.id, data: m.data }));
  }
  async webSocketClose(ws, code) {
    const me = ws.deserializeAttachment();
    try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, 'closed'); } catch {}
    if (!me || me.replaced || me.intentional || (await this.ctx.storage.get('status')) === 'closed') return;
    const st = this.ctx.storage, members = (await st.get('members')) || {}, member = members[me.id];
    if (!member) return;
    member.deadline = Date.now() + RECONNECT_GRACE_MS;
    members[me.id] = member;
    await st.put('members', members);
    if (me.authority) {
      await st.put('status', 'waiting-authority');
      this._broadcast({ t: 'authority-disconnected', id: me.id, deadline: member.deadline });
    } else this._broadcast({ t: 'peer-disconnected', id: me.id, deadline: member.deadline }, me.id);
    await this._scheduleAlarm();
  }
  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }
  // 全Peer退出時だけRoomを終了し、作成制限の枠を返す。
  async _closeRoom(cooldown) {
    const st = this.ctx.storage;
    if ((await st.get('status')) === 'closed') return;
    await st.put({ status: 'closed', authorityId: '' });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ t: 'closed', reason: 'room-empty' })); ws.close(1000, 'room-empty'); } catch { /* 無視 */ }
    }
    await st.setAlarm(Date.now() + ROOM_CLOSED_KEEP_MS);
    await this._release(cooldown);
  }
  async _release(cooldown) {
    const st = this.ctx.storage;
    await releaseSlot(this.env, await st.get('ipHash'), await st.get('code'), cooldown ? Date.now() : null);
  }
  async alarm() {
    const st = this.ctx.storage, status = await st.get('status');
    if (status === 'closed') { await st.deleteAll(); return; }
    if (status === 'waiting') { await this._release(false); await st.deleteAll(); return; }
    const members = (await st.get('members')) || {}, now = Date.now();
    for (const member of Object.values(members)) {
      if (member.deadline && member.deadline <= now) {
        delete members[member.id];
        if (member.authority && (await st.get('authorityId')) === member.id) {
          await st.put({ authorityId: '', status: 'waiting-authority' });
          this._broadcast({ t: 'authority-left', id: member.id });
        } else this._broadcast({ t: 'peer-leave', id: member.id });
      }
    }
    await st.put('members', members);
    if (Object.keys(members).length === 0 && this.ctx.getWebSockets().length === 0) { await this._closeRoom(true); return; }
    await this._scheduleAlarm();
  }
}
