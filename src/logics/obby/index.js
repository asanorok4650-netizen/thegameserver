/** Built-in Obby logic definition (metadata only). */
export const obbyLogic = Object.freeze({
  id: 'obby',
  name: 'Obby (障害物コース)',
  description: '落下判定やチェックポイントなど、障害物コース向けのタグを設定できます。',
  version: 1,
  parameters: {
    killY: {
      type: 'number',
      label: '落下判定の高さ (Y)',
      description: 'プレイヤーがこの高さを下回ったときの判定に使用します。',
      default: -50,
      min: -10000,
      max: 10000,
      step: 1
    }
  },
  tags: [
    { id: 'kill', label: 'キル', description: '触れるとリスポーンするパーツ' },
    { id: 'checkpoint', label: 'チェックポイント', description: '触れると復帰地点になるパーツ' },
    { id: 'goal', label: 'ゴール', description: '触れるとクリア扱いになるパーツ' }
  ]
});
