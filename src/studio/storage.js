// 下書きのローカル保存(IndexedDB)。サーバーには一切送らない。
// 使えない環境(プライベートモード等)でも落ちず、false/null を返すだけにする。
const DB = 'tgw-studio', STORE = 'drafts', KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** 下書きを保存。doc はそのまま(構造化複製できるJSON互換のオブジェクト) */
export async function saveDraft(doc) {
  try { await tx('readwrite', (s) => s.put({ doc, savedAt: Date.now() }, KEY)); return true; }
  catch { return false; }
}

/** @returns { doc, savedAt } | null */
export async function loadDraft() {
  try { return (await tx('readonly', (s) => s.get(KEY))) || null; }
  catch { return null; }
}

export async function clearDraft() {
  try { await tx('readwrite', (s) => s.delete(KEY)); return true; }
  catch { return false; }
}

/** 変更が止まってから ms 後に1回だけ保存する(ドラッグ中に毎フレーム書かない) */
export function createAutosaver(getDoc, { ms = 1500, onSaved = () => {} } = {}) {
  let timer = null;
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(async () => { const ok = await saveDraft(getDoc()); onSaved(ok); }, ms);
    },
    async flush() { clearTimeout(timer); timer = null; const ok = await saveDraft(getDoc()); onSaved(ok); },
    cancel() { clearTimeout(timer); timer = null; }
  };
}
