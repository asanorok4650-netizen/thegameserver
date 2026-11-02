// RBXL Player サーバーAPI(Cloudflare Worker)
//   GET    /api/health             接続確認(D1/R2/合言葉の設定状況)
//   GET    /api/servers            一覧(公開)
//   GET    /api/servers/:id/file   rbxl本体(公開)
//   POST   /api/servers?name=&description=&format=   追加(要合言葉。ボディにファイルそのもの)
//   PUT    /api/servers/:id?name=&description=&format=  同じidのまま差し替え(要合言葉。Studioの上書き公開用)
//   DELETE /api/servers/:id        削除(要合言葉)
//   POST   /api/rooms              マルチプレイのルーム作成(body: {serverId})→ {roomId}(6文字のコード)
//   GET    /api/rooms/:code/info   ルームの情報 {serverId, status, players, max}
//   GET    /api/rooms/:code/ws     WebSocket(シグナリング専用。ゲームのデータは流さない。ホストは &host=1)
// format は rbxl / rbxlx / tgw(.tgw はZIP。Workerは展開せず、R2に置いて配信するだけ)。
// 合言葉は Authorization: Bearer <ADMIN_PASSPHRASE> で送る。

const MAX_BYTES = 100 * 1024 * 1024; // Workersのリクエスト上限(無料/Proプラン)に合わせる
const FORMATS = ['rbxl', 'rbxlx', 'tgw'];

// ── マルチプレイ(Hybrid P2P)。DOはRoomの状態とWebRTCのシグナリングだけを扱う ──
const ROOM_MAX = 8;
const ROOM_TTL_MS = 60 * 60 * 1000;      // 参加者がいなければ1時間で片付ける
const MAX_SIGNAL_CHARS = 16384;          // シグナリング1メッセージの上限(SDP/ICE)
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32文字(I・Oなし)
function newRoomCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => ROOM_ALPHABET[x % ROOM_ALPHABET.length]).join('');
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
        return json({ ok: true, db, r2: !!env.BUCKET, hasAdmin: !!env.ADMIN_PASSPHRASE, count }, 200, h);
      }

      if (path === '/api/rooms' && request.method === 'POST') {
        if (!env.ROOM) return json({ error: 'room_not_configured' }, 501, h);
        const body = await request.json().catch(() => null);
        const serverId = body && typeof body.serverId === 'string' ? body.serverId : '';
        if (!/^[0-9a-f-]{36}$/.test(serverId)) return json({ error: 'bad_server' }, 400, h);
        if (!(await env.DB.prepare('SELECT id FROM servers WHERE id = ?').bind(serverId).first())) return json({ error: 'not_found' }, 404, h);
        for (let i = 0; i < 5; i++) {
          const code = newRoomCode();
          const res = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ serverId }) });
          if (res.ok) return json({ roomId: code }, 201, h);
        }
        return json({ error: 'busy' }, 503, h);
      }

      const rm = path.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(ws|info)$/);
      if (rm) {
        if (!env.ROOM) return json({ error: 'room_not_configured' }, 501, h);
        const stub = env.ROOM.get(env.ROOM.idFromName(rm[1]));
        if (rm[2] === 'ws') return stub.fetch(request);
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

// 1 Room = 1 Durable Object。WebSocketは参加・退出の通知とSDP/ICEの中継だけに使う(Hibernation APIなので待機中は課金されにくい)。
// 位置・入力などのゲームデータはWebRTC DataChannelで直接やり取りし、ここは通さない。
// 初期版: ホストが抜けたらRoom終了。
export class Room {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  _byId(id) { return this.ctx.getWebSockets().find((ws) => ws.deserializeAttachment()?.id === id); }
  _res(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }

  async fetch(request) {
    const st = this.ctx.storage;
    const url = new URL(request.url);
    if (url.pathname === '/init' && request.method === 'POST') {
      if (await st.get('serverId')) return this._res({ error: 'exists' }, 409);
      const { serverId } = await request.json();
      await st.put({ serverId, status: 'waiting', createdAt: Date.now() });
      await st.setAlarm(Date.now() + ROOM_TTL_MS);
      return this._res({ ok: true });
    }
    const serverId = await st.get('serverId');
    if (!serverId) return this._res({ error: 'not_found' }, 404);
    const status = await st.get('status');

    if (url.pathname.endsWith('/info')) {
      return this._res({ serverId, status, players: this.ctx.getWebSockets().length, max: ROOM_MAX });
    }

    if (url.pathname.endsWith('/ws')) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (status === 'closed') return new Response('closed', { status: 410 });
      if (this.ctx.getWebSockets().length >= ROOM_MAX) return new Response('full', { status: 409 });
      const wantHost = url.searchParams.get('host') === '1';
      let hostId = await st.get('hostId');
      if (wantHost === !!hostId) return new Response(wantHost ? 'host_exists' : 'no_host', { status: 409 }); // ホストは最初の1人だけ。参加者はホストの後
      const seq = ((await st.get('seq')) || 0) + 1;
      const id = 'p' + seq;
      const name = cleanName(url.searchParams.get('name'));
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ id, name, host: wantHost });
      if (wantHost) { hostId = id; await st.put({ seq, hostId, status: 'running' }); } else await st.put('seq', seq);
      server.send(JSON.stringify({ t: 'hello', id, host: wantHost, hostId, max: ROOM_MAX }));
      if (!wantHost) this._byId(hostId)?.send(JSON.stringify({ t: 'peer-join', id, name }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return this._res({ error: 'not_found' }, 404);
  }

  // シグナリング: ホスト⇔クライアントだけ中継する(Star型。クライアント同士は繋がない)
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_SIGNAL_CHARS) return;
    let m; try { m = JSON.parse(message); } catch (e) { return; }
    if (!m || m.t !== 'signal' || typeof m.to !== 'string') return;
    const me = ws.deserializeAttachment();
    const target = this._byId(m.to);
    const other = target?.deserializeAttachment();
    if (!me || !other || (!me.host && !other.host)) return;
    target.send(JSON.stringify({ t: 'signal', from: me.id, data: m.data }));
  }

  async webSocketClose(ws, code) {
    const me = ws.deserializeAttachment();
    try { ws.close(code && code !== 1005 && code !== 1006 ? code : 1000, 'closed'); } catch (e) { /* 閉じ済み */ }
    if (!me) return;
    if (me.host) {
      await this.ctx.storage.put('status', 'closed');
      for (const other of this.ctx.getWebSockets()) {
        try { other.send(JSON.stringify({ t: 'closed', reason: 'host-left' })); other.close(1000, 'host-left'); } catch (e) { /* 無視 */ }
      }
      await this.ctx.storage.setAlarm(Date.now() + 60 * 1000);
    } else {
      const hostId = await this.ctx.storage.get('hostId');
      this._byId(hostId)?.send(JSON.stringify({ t: 'peer-leave', id: me.id }));
    }
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }

  // 期限切れ・終了済みのRoomを片付ける(ゲームループや生存監視には使わない)
  async alarm() {
    const closed = (await this.ctx.storage.get('status')) === 'closed';
    if (closed || this.ctx.getWebSockets().length === 0) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }
}
