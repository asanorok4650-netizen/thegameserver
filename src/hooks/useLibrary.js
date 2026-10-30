import { useState } from 'react';

const STORAGE_KEY = 'rbxl-player-recent-v1'; // 旧版と同じキー(既存データを引き継げます)
const MAX_ITEMS = 12;

function readItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useLibrary() {
  const [items, setItems] = useState(readItems);

  // 成功: { ok: true } / 失敗: { ok: false }
  function addFile(file, extension) {
    const next = [
      { name: file.name, size: file.size, openedAt: new Date().toISOString(), format: extension },
      ...readItems().filter((item) => item.name !== file.name)
    ].slice(0, MAX_ITEMS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setItems(next);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  return { items, addFile };
}
