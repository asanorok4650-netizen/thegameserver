// ページ定義(元 navigation.js の sections)
export const PAGES = {
  home: {
    title: 'ホーム',
    subtitle: 'お気に入りのワールドに戻ろう。',
    sections: ['recent', 'library']
  },
  discover: {
    title: '探索',
    subtitle: '新しいワールドを見つけよう。',
    sections: ['discover']
  },
  friends: {
    title: 'フレンド',
    subtitle: '一緒に遊ぶ仲間を見つけよう。',
    sections: ['friends']
  },
  recent: {
    title: '最近プレイしたゲーム',
    subtitle: '最近開いたワールド。',
    sections: ['recent']
  },
  avatar: {
    title: 'アバター',
    subtitle: 'パーツを組み合わせてアバターを作ろう。',
    sections: ['avatar']
  },
  settings: {
    title: '設定',
    subtitle: '接続と描画の設定。',
    sections: ['settings']
  }
};

export const NAV_ITEMS = [
  { page: 'home', icon: '⌂', label: 'ホーム' },
  { page: 'discover', icon: '◈', label: '探索' },
  { page: 'friends', icon: '♧', label: 'フレンド' },
  { page: 'recent', icon: '◷', label: '最近プレイしたゲーム' },
  { page: 'avatar', icon: '☺', label: 'アバター' },
  { page: 'settings', icon: '⚙', label: '設定' }
];
