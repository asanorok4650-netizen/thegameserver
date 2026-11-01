// RBXL Player サーバーAPI(Cloudflare Worker)
//   GET    /api/health             接続確認(D1/R2/合言葉の設定状況)
//   GET    /api/servers            一覧(公開)
//   GET    /api/servers/:id/file   rbxl本体(公開)
//   POST   /api/servers?name=&description=&format=   追加(要合言葉。ボディにファイルそのもの)
//   PUT    /api/servers/:id?name=&description=&format=  同じidのまま差し替え(要合言葉。Studioの上書き公開用)
//   DELETE /api/servers/:id        削除(要合言葉)
// format は rbxl / rbxlx / tgw(.tgw はZIP。Workerは展開せず、R2に置いて配信するだけ)。
// 合言葉は Authorization: Bearer <ADMIN_PASSPHRASE> で送る。

const MAX_BYTES = 100 * 1024 * 1024; // Workersのリクエスト上限(無料/Proプラン)に合わせる
const FORMATS = ['rbxl', 'rbxlx', 'tgw'];

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
