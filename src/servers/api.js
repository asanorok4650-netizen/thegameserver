// サーバーAPI(worker/index.js)クライアント
import { CONFIG } from '../config.js';

const base = () => CONFIG.apiBase.replace(/\/+$/, '');

async function request(path, options) {
  if (!base()) throw new Error('API_NOT_CONFIGURED');
  const res = await fetch(base() + path, options);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((body && body.error) || 'HTTP_' + res.status);
    err.status = res.status;
    throw err;
  }
  return body;
}

const auth = (pass) => ({ Authorization: 'Bearer ' + pass });

export const getHealth = () => request('/api/health');
export const listServers = async () => (await request('/api/servers')).servers;
export const serverFileUrl = (id) => `${base()}/api/servers/${id}/file`;

export function addServer({ name, description, file }, pass) {
  const format = file.name.split('.').pop().toLowerCase();
  const q = new URLSearchParams({ name, description: description || '', format });
  return request('/api/servers?' + q, {
    method: 'POST',
    headers: { ...auth(pass), 'Content-Type': 'application/octet-stream' },
    body: file
  });
}

/** 同じidのまま差し替える(Studioの上書き公開)。Workerに PUT が無い古い版だと 404/405 になる */
export function updateServer(id, { name, description, file }, pass) {
  const format = file.name.split('.').pop().toLowerCase();
  const q = new URLSearchParams({ name, description: description || '', format });
  return request('/api/servers/' + id + '?' + q, {
    method: 'PUT',
    headers: { ...auth(pass), 'Content-Type': 'application/octet-stream' },
    body: file
  });
}

export const deleteServer =(id, pass) =>
  request('/api/servers/' + id, { method: 'DELETE', headers: auth(pass) });

export function describeError(e) {
  const code = (e && e.message) || '';
  if (code === 'API_NOT_CONFIGURED') return '設定ページでAPI URLを入力してください。';
  if (code === 'unauthorized') return '合言葉が違います。';
  if (code === 'too_large') return 'ファイルが大きすぎます(上限100MB)。';
  if (code === 'bad_format') return '.tgw / .rbxl / .rbxlx のみ追加できます。';
  if (code === 'name_required') return '名前を入力してください。';
  return 'サーバーAPIに接続できませんでした。URLとWorkerのデプロイを確認してください。';
}
