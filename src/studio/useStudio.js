// Studioの状態(ドキュメント・履歴・選択・ローカル自動保存)。通信は publish() の中だけ。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addPart, removeParts, duplicateParts, updateParts, movePartsBy, setMeta, createStarterDoc, checkDoc, addSpawn, removeSpawn
} from './model.js';
import { createHistory, commit, undo, redo, canUndo, canRedo, markSaved, isDirty, reset } from './history.js';
import { loadDraft, saveDraft, clearDraft } from './storage.js';
import { downloadTgw, openFile, publishDoc } from './io.js';
import { CONFIG } from '../config.js';

export function useStudio() {
  const [h, setH] = useState(() => createHistory(createStarterDoc()));
  const [selection, setSelection] = useState([]);
  const [message, setMessage] = useState({ text: '', kind: '' });
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const hRef = useRef(h);
  hRef.current = h;
  const doc = h.present;

  const say = useCallback((text, kind = '') => setMessage({ text, kind }), []);

  // 初回: ローカルの下書きがあれば復元(通信なし)
  useEffect(() => {
    let dead = false;
    loadDraft().then((d) => {
      if (dead) return;
      if (d && d.doc && Array.isArray(d.doc.parts)) {
        setH((prev) => markSaved(reset(prev, d.doc)));
        say('前回の下書きを復元しました', 'ok');
      }
      setReady(true);
    });
    return () => { dead = true; };
  }, [say]);

  // 自動保存(ローカルのみ。変更が止まって1.5秒後)
  useEffect(() => {
    if (!ready || !isDirty(h)) return undefined;
    const t = setTimeout(() => { saveDraft(hRef.current.present); }, 1500);
    return () => clearTimeout(t);
  }, [h.present, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // ページを離れる/閉じる時に未保存を警告
  useEffect(() => {
    const onBefore = (e) => { if (isDirty(hRef.current)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  // 選択のうち、削除されたパーツのidを落とす
  useEffect(() => {
    setSelection((sel) => {
      if (!sel.length) return sel;
      const alive = new Set(doc.parts.map((p) => p.id));
      const next = sel.filter((id) => alive.has(id));
      return next.length === sel.length ? sel : next;
    });
  }, [doc]);

  /** doc を更新して履歴に積む。fn は (doc) => 新doc | { doc, select:[ids] } */
  const apply = useCallback((fn, key = null) => {
    let select = null;
    setH((prev) => {
      const r = fn(prev.present);
      const next = r && r.doc ? r.doc : r;
      if (r && r.doc && r.select) select = r.select;
      return commit(prev, next, { key });
    });
    if (select) setSelection(select);
  }, []);

  const actions = useMemo(() => ({
    undo: () => setH((p) => undo(p)),
    redo: () => setH((p) => redo(p)),
    select: (id, additive) => setSelection((sel) => {
      if (id === null) return additive ? sel : [];
      if (!additive) return [id];
      return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    }),
    selectOnly: (ids) => setSelection(ids),
    add: (shape, at) => apply((d) => {
      const size = shape === 'ball' ? [4, 4, 4] : shape === 'cylinder' ? [4, 4, 4] : [4, 1, 4];
      const pos = at ? [Math.round(at[0]), Math.round(at[1] + size[1] / 2), Math.round(at[2])] : undefined;
      const r = addPart(d, { shape, size, pos, name: shape === 'block' ? 'Part' : shape });
      return { doc: r.doc, select: [r.id] };
    }),
    remove: (ids) => apply((d) => removeParts(d, ids)),
    duplicate: (ids) => apply((d) => { const r = duplicateParts(d, ids); return { doc: r.doc, select: r.ids }; }),
    patch: (ids, p, key) => apply((d) => updateParts(d, ids, p), key),
    nudge: (ids, delta) => apply((d) => movePartsBy(d, ids, delta), 'nudge'),
    meta: (p, key) => apply((d) => setMeta(d, p), key || 'meta'),
    addSpawn: (pos) => apply((d) => addSpawn(d, { pos })),
    removeSpawn: (index) => apply((d) => removeSpawn(d, index)),
    newDoc: () => { setH((p) => reset(p, createStarterDoc())); setSelection([]); clearDraft(); say('新しいワールドを作りました', 'ok'); }
  }), [apply, say]);

  const open = useCallback(async (file) => {
    setBusy(true); say('読み込み中…');
    try {
      const { doc: next, warnings } = await openFile(file);
      setH((p) => reset(p, next));
      setSelection([]);
      say(`「${next.name}」を開きました(パーツ ${next.parts.length}個)${warnings.length ? ` / 警告 ${warnings.length}件` : ''}`, 'ok');
    } catch (e) { say(e.message || String(e), 'error'); }
    finally { setBusy(false); }
  }, [say]);

  const exportFile = useCallback(async () => {
    setBusy(true);
    try {
      const size = await downloadTgw(hRef.current.present);
      setH((p) => markSaved(p));
      say(`.tgw を書き出しました(${(size / 1048576).toFixed(2)}MB)`, 'ok');
    } catch (e) { say(e.message || String(e), 'error'); }
    finally { setBusy(false); }
  }, [say]);

  const saveLocal = useCallback(async () => {
    const ok = await saveDraft(hRef.current.present);
    if (ok) setH((p) => markSaved(p));
    say(ok ? 'このブラウザに保存しました' : 'このブラウザには保存できませんでした(.tgw の書き出しをご利用ください)', ok ? 'ok' : 'error');
  }, [say]);

  /** 公開(サーバーへ送るのはここだけ) */
  const publish = useCallback(async () => {
    const d = hRef.current.present;
    const { errors } = checkDoc(d);
    if (errors.length) return say(errors.join(' / '), 'error');
    if (!CONFIG.apiBase) return say('設定ページでサーバーAPIのURLを入力してください。', 'error');
    if (!CONFIG.adminPassphrase) return say('設定ページで管理用の合言葉を入力してください。', 'error');
    setBusy(true); say('公開中…');
    try {
      const r = await publishDoc(d, CONFIG.adminPassphrase, { replace: true });
      setH((p) => markSaved(commit(p, setMeta(p.present, { publishedId: r.id }), { key: 'publish' })));
      saveDraft({ ...hRef.current.present, publishedId: r.id });
      say(`公開しました(${(r.size / 1048576).toFixed(2)}MB)${r.replaced ? ' / 以前の公開を置き換えました' : ''}`, 'ok');
    } catch (e) {
      const { describeError } = await import('../servers/api.js');
      say(describeError(e), 'error');
    } finally { setBusy(false); }
  }, [say]);

  return {
    doc, selection, message, busy, ready,
    dirty: isDirty(h), canUndo: canUndo(h), canRedo: canRedo(h),
    actions, open, exportFile, saveLocal, publish, say
  };
}
