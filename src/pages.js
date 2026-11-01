// ページ定義(元 navigation.js の sections)
export const PAGES = {
  home: {
    title: 'ホーム',
    subtitle: 'お気に入りのワールドに戻ろう。',
    sections: ['servers']
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
  avatar: {
    title: 'アバター',
    subtitle: 'パーツを組み合わせてアバターを作ろう。',
    sections: ['avatar']
  },
  studio: {
    title: 'Studio',
    subtitle: 'ワールドを作って公開しよう。',
    sections: []
  },
  settings: {
    title: '設定',
    subtitle: '接続と描画の設定。',
    sections: ['settings']
  }
};

export const NAV_ITEMS = [
  { page: 'home', icon: 'home', label: 'ホーム' },
  { page: 'discover', icon: 'compass', label: '探索' },
  { page: 'friends', icon: 'users', label: 'フレンド' },
  { page: 'avatar', icon: 'user', label: 'アバター' },
  { page: 'studio', icon: 'box', label: 'Studio' },
  { page: 'settings', icon: 'settings', label: '設定' }
];
