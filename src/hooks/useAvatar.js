import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';
import { DEMOS } from '../avatar/demo.js';
import { loadUserAvatar, ApiError } from '../avatar/api.js';

// アバターの状態(記述子・ユーザー・読み込み状況)。App側で保持するので、ページを移動しても消えない。
export function useAvatar() {
  const [desc, setDesc] = useState(() => DEMOS[0].make());
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState({ text: 'デモアバターを表示中', kind: '' });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const startedRef = useRef(false);

  const loadUser = useCallback(async (input) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await loadUserAvatar(input, (text) => setStatus({ text, kind: '' }));
      setDesc(r.desc);
      setUser(r.user);
      CONFIG.lastUser = String(input).trim();
      const skip = r.desc.report.filter((x) => x.status === 'skip').length;
      const bad = r.desc.report.filter((x) => x.status === 'error').length;
      setStatus({
        text: `${r.user.displayName} を読み込みました` + (skip ? `(未対応アセット ${skip}件)` : '') + (bad ? `(失敗 ${bad}件)` : ''),
        kind: 'ok'
      });
    } catch (e) {
      const text = e instanceof ApiError && e.code === 'NO_PROXY'
        ? 'プロキシが未設定です。設定ページでURLを入力するか、デモアバターを使ってください。'
        : (e.message || String(e));
      setStatus({ text, kind: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const loadDemo = useCallback((demo) => {
    setDesc(demo.make());
    setUser(null);
    setStatus({ text: `デモ「${demo.label}」を表示中`, kind: '' });
  }, []);

  // 前回のユーザーを自動で読み込む(プロキシ設定済みの場合のみ)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (CONFIG.lastUser && CONFIG.proxyBase) loadUser(CONFIG.lastUser);
  }, [loadUser]);

  return { desc, user, status, busy, loadUser, loadDemo, demos: DEMOS };
}
