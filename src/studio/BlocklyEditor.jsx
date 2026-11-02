import { useEffect, useRef } from 'react';
import './blockly-editor.css';

let registered = false;
function registerBlocks(Blockly) {
  if (registered) return;
  registered = true;
  const definitions = [
    // Events: hats are roots, but expose a next connection for their script.
    { type: 'rbxl_when_start', message0: 'ゲームが始まったとき', hat: 'cap', nextStatement: null, colour: 25 },
    { type: 'rbxl_when_touch', message0: 'パーツ %1 に触れたとき', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }], hat: 'cap', nextStatement: null, colour: 25 },
    { type: 'rbxl_when_leave', message0: 'パーツ %1 から離れたとき', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }], hat: 'cap', nextStatement: null, colour: 25 },
    { type: 'rbxl_when_player_spawn', message0: 'プレイヤーがスポーンしたとき', hat: 'cap', nextStatement: null, colour: 25 },
    { type: 'rbxl_when_interval', message0: '%1 秒ごと', args0: [{ type: 'field_number', name: 'SECONDS', value: 1, min: 0.1, max: 3600, precision: 0.1 }], hat: 'cap', nextStatement: null, colour: 25 },

    // Control flow.
    { type: 'rbxl_wait', message0: '%1 秒待つ', args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_if', message0: 'もし %1 なら %2', args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_if_else', message0: 'もし %1 なら %2 でなければ %3', args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }, { type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_repeat', message0: '%1 回繰り返す %2', args0: [{ type: 'field_number', name: 'TIMES', value: 10, min: 0, max: 1000, precision: 1 }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_forever', message0: 'ずっと繰り返す %1', args0: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 40 },

    // Actions.
    { type: 'rbxl_add_score', message0: 'スコアを %1 増やす', args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_show_message', message0: 'メッセージ %1 を表示', args0: [{ type: 'field_input', name: 'TEXT', text: 'こんにちは！' }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_visible', message0: 'パーツ %1 を表示 %2', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_checkbox', name: 'VISIBLE', checked: true }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_move_part', message0: 'パーツ %1 の位置を X %2 Y %3 Z %4 にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_number', name: 'X', value: 0 }, { type: 'field_number', name: 'Y', value: 0 }, { type: 'field_number', name: 'Z', value: 0 }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_color', message0: '%1', args0: [{ type: 'field_colour', name: 'COLOR', colour: '#ff0000' }], output: 'Colour', colour: 160 },
    { type: 'rbxl_part_set_color', message0: 'パーツ %1 の色を %2 にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'input_value', name: 'VALUE', check: 'Colour' }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_get_color', message0: 'パーツ %1 の色', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }], output: 'Colour', colour: 160 },
    { type: 'rbxl_part_set_size', message0: 'パーツ %1 のサイズを X %2 Y %3 Z %4 にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_number', name: 'X', value: 4, min: 0.1, max: 1000 }, { type: 'field_number', name: 'Y', value: 1, min: 0.1, max: 1000 }, { type: 'field_number', name: 'Z', value: 2, min: 0.1, max: 1000 }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_set_position', message0: 'パーツ %1 の位置を X %2 Y %3 Z %4 にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_number', name: 'X', value: 0 }, { type: 'field_number', name: 'Y', value: 0 }, { type: 'field_number', name: 'Z', value: 0 }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_set_rotation', message0: 'パーツ %1 の回転を X %2 Y %3 Z %4 度にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_number', name: 'X', value: 0 }, { type: 'field_number', name: 'Y', value: 0 }, { type: 'field_number', name: 'Z', value: 0 }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_set_transparency', message0: 'パーツ %1 の透明度を %2 にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_number', name: 'VALUE', value: 0, min: 0, max: 1, precision: 0.05 }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_set_collision', message0: 'パーツ %1 の衝突を %2 にする', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_checkbox', name: 'ENABLED', checked: true }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_part_get_number', message0: 'パーツ %1 の %2', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_dropdown', name: 'PROPERTY', options: [['サイズ X', 'sizeX'], ['サイズ Y', 'sizeY'], ['サイズ Z', 'sizeZ'], ['位置 X', 'positionX'], ['位置 Y', 'positionY'], ['位置 Z', 'positionZ'], ['回転 X', 'rotationX'], ['回転 Y', 'rotationY'], ['回転 Z', 'rotationZ'], ['透明度', 'transparency']] }], output: 'Number', colour: 160 },
    { type: 'rbxl_part_get_collision', message0: 'パーツ %1 は衝突する', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }], output: 'Boolean', colour: 160 },
    { type: 'rbxl_set_checkpoint', message0: 'チェックポイントを設定する', previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_teleport', message0: 'プレイヤーをパーツ %1 に移動する', args0: [{ type: 'field_input', name: 'PART', text: 'Spawn' }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_respawn', message0: 'プレイヤーをリスポーンさせる', previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_player_get_number', message0: 'プレイヤー %1 の %2', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_dropdown', name: 'PROPERTY', options: [['HP', 'health'], ['最大HP', 'maxHealth'], ['位置 X', 'positionX'], ['位置 Y', 'positionY'], ['位置 Z', 'positionZ'], ['移動速度', 'walkSpeed'], ['ジャンプ力', 'jumpPower']] }], output: 'Number', colour: 205 },
    { type: 'rbxl_player_is_alive', message0: 'プレイヤー %1 は生存している', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }], output: 'Boolean', colour: 205 },
    { type: 'rbxl_player_set_health', message0: 'プレイヤー %1 の HP を %2 にする', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_number', name: 'VALUE', value: 100, min: 0, max: 100000 }], previousStatement: null, nextStatement: null, colour: 205 },
    { type: 'rbxl_player_set_position', message0: 'プレイヤー %1 を X %2 Y %3 Z %4 に移動する', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_number', name: 'X', value: 0 }, { type: 'field_number', name: 'Y', value: 10 }, { type: 'field_number', name: 'Z', value: 0 }], previousStatement: null, nextStatement: null, colour: 205 },
    { type: 'rbxl_player_set_walk_speed', message0: 'プレイヤー %1 の移動速度を %2 にする', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_number', name: 'VALUE', value: 16, min: 0, max: 200 }], previousStatement: null, nextStatement: null, colour: 205 },
    { type: 'rbxl_player_set_jump_power', message0: 'プレイヤー %1 のジャンプ力を %2 にする', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_number', name: 'VALUE', value: 12, min: 0, max: 200 }], previousStatement: null, nextStatement: null, colour: 205 },
    { type: 'rbxl_player_damage', message0: 'プレイヤー %1 に %2 ダメージを与える', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_number', name: 'VALUE', value: 10, min: 0, max: 100000 }], previousStatement: null, nextStatement: null, colour: 205 },
    { type: 'rbxl_player_heal', message0: 'プレイヤー %1 を %2 回復する', args0: [{ type: 'field_input', name: 'PLAYER', text: 'local' }, { type: 'field_number', name: 'VALUE', value: 10, min: 0, max: 100000 }], previousStatement: null, nextStatement: null, colour: 205 },
    { type: 'rbxl_complete', message0: 'ゲームをクリアにする', previousStatement: null, nextStatement: null, colour: 145 },

    // Variables. Keep the Phase 1 text-name block for saved-workspace compatibility.
    { type: 'rbxl_set_variable', message0: '変数 %1 を %2 にする', args0: [{ type: 'field_input', name: 'NAME', text: 'coins' }, { type: 'input_value', name: 'VALUE' }], previousStatement: null, nextStatement: null, colour: 330 },
    { type: 'rbxl_set_named_variable', message0: '変数 %1 を %2 にする', args0: [{ type: 'field_variable', name: 'VAR', variable: 'coins' }, { type: 'input_value', name: 'VALUE' }], previousStatement: null, nextStatement: null, colour: 330 },
    { type: 'rbxl_change_variable', message0: '変数 %1 を %2 だけ増やす', args0: [{ type: 'field_variable', name: 'VAR', variable: 'coins' }, { type: 'input_value', name: 'VALUE', check: 'Number' }], previousStatement: null, nextStatement: null, colour: 330 },

    // M1-B: strings, random values, elapsed time and lists.
    { type: 'rbxl_text', message0: '%1', args0: [{ type: 'field_input', name: 'TEXT', text: 'テキスト' }], output: 'String', colour: 190 },
    { type: 'rbxl_text_join', message0: '文字列 %1 と %2 をつなげる', args0: [{ type: 'input_value', name: 'A', check: 'String' }, { type: 'input_value', name: 'B', check: 'String' }], output: 'String', colour: 190 },
    { type: 'rbxl_random', message0: '%1 から %2 までの乱数', args0: [{ type: 'input_value', name: 'MIN', check: 'Number' }, { type: 'input_value', name: 'MAX', check: 'Number' }], output: 'Number', colour: 210 },
    { type: 'rbxl_elapsed_time', message0: 'ゲーム開始からの経過秒数', output: 'Number', colour: 210 },
    { type: 'rbxl_list_create', message0: 'リストを作る %1 %2 %3', args0: [{ type: 'input_value', name: 'ADD0' }, { type: 'input_value', name: 'ADD1' }, { type: 'input_value', name: 'ADD2' }], output: 'Array', colour: 285 },
    { type: 'rbxl_list_length', message0: 'リスト %1 の長さ', args0: [{ type: 'input_value', name: 'LIST', check: 'Array' }], output: 'Number', colour: 285 },
    { type: 'rbxl_list_get', message0: 'リスト %1 の %2 番目', args0: [{ type: 'input_value', name: 'LIST', check: 'Array' }, { type: 'input_value', name: 'INDEX', check: 'Number' }], output: null, colour: 285 },
    { type: 'rbxl_list_add', message0: 'リスト変数 %1 に %2 を追加', args0: [{ type: 'field_variable', name: 'VAR', variable: 'items' }, { type: 'input_value', name: 'VALUE' }], previousStatement: null, nextStatement: null, colour: 285 },
    { type: 'rbxl_list_replace', message0: 'リスト変数 %1 の %2 番目を %3 に置き換える', args0: [{ type: 'field_variable', name: 'VAR', variable: 'items' }, { type: 'input_value', name: 'INDEX', check: 'Number' }, { type: 'input_value', name: 'VALUE' }], previousStatement: null, nextStatement: null, colour: 285 },

    // Values and logic.
    { type: 'rbxl_compare', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'field_dropdown', name: 'OP', options: [['=', 'EQ'], ['>', 'GT'], ['<', 'LT'], ['≧', 'GTE'], ['≦', 'LTE'], ['≠', 'NEQ']] }, { type: 'input_value', name: 'B', check: 'Number' }], output: 'Boolean', colour: 210 },
    { type: 'rbxl_number', message0: '%1', args0: [{ type: 'field_number', name: 'VALUE', value: 0 }], output: 'Number', colour: 210 }
  ];
  Blockly.common.defineBlocksWithJsonArray(definitions);
}

const block = (type) => ({ kind: 'block', type });
const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'イベント', colour: '#e6a23c', contents: [
      block('rbxl_when_start'), block('rbxl_when_touch'), block('rbxl_when_leave'), block('rbxl_when_player_spawn'), block('rbxl_when_interval')
    ] },
    { kind: 'category', name: '制御', colour: '#d6a23a', contents: [
      block('rbxl_wait'), block('rbxl_if'), block('rbxl_if_else'), block('rbxl_repeat'), block('rbxl_forever')
    ] },
    { kind: 'category', name: 'アクション', colour: '#43a879', contents: [
      block('rbxl_add_score'), block('rbxl_show_message'), block('rbxl_part_visible'),
      block('rbxl_move_part'), block('rbxl_color'), block('rbxl_part_set_color'), block('rbxl_part_get_color'), block('rbxl_part_set_size'), block('rbxl_part_set_position'), block('rbxl_part_set_rotation'), block('rbxl_part_set_transparency'), block('rbxl_part_set_collision'), block('rbxl_part_get_number'), block('rbxl_part_get_collision'), block('rbxl_set_checkpoint'), block('rbxl_complete')
    ] },
    { kind: 'category', name: 'プレイヤー', colour: '#438bd0', contents: [
      block('rbxl_player_get_number'), block('rbxl_player_is_alive'), block('rbxl_player_set_health'),
      block('rbxl_player_set_position'), block('rbxl_player_set_walk_speed'), block('rbxl_player_set_jump_power'),
      block('rbxl_player_damage'), block('rbxl_player_heal'), block('rbxl_teleport'), block('rbxl_respawn')
    ] },
    { kind: 'category', name: '変数', colour: '#a879ce', custom: 'VARIABLE' },
    { kind: 'category', name: 'データ', colour: '#b18ad5', contents: [
      block('rbxl_text'), block('rbxl_text_join'), block('rbxl_list_create'),
      block('rbxl_list_length'), block('rbxl_list_get'), block('rbxl_list_add'), block('rbxl_list_replace')
    ] },
    { kind: 'category', name: '計算・条件', colour: '#5796d2', contents: [
      block('rbxl_random'), block('rbxl_elapsed_time'),
      block('rbxl_number'), block('rbxl_compare'), block('math_number'), block('math_arithmetic'),
      block('logic_compare'), block('logic_operation'), block('logic_negate'), block('logic_boolean')
    ] },
    { kind: 'category', name: '標準ブロック', colour: '#8793a5', contents: [
      block('controls_if'), block('controls_repeat_ext'),
      block('math_single'), block('math_modulo')
    ] }
  ]
};

export default function BlocklyEditor({ initialState, onChange }) {
  const hostRef = useRef(null);
  const workspaceRef = useRef(null);
  const BlocklyRef = useRef(null);
  const initialStateRef = useRef(initialState);
  initialStateRef.current = initialState;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    let workspace = null;
    let resizeObserver = null;
    let timer = null;
    let listener = null;

    (async () => {
      try {
        const [Blockly] = await Promise.all([import('blockly'), import('blockly/blocks')]);
        if (disposed) return;
        BlocklyRef.current = Blockly;
        registerBlocks(Blockly);
        workspace = Blockly.inject(hostRef.current, {
          toolbox,
          renderer: 'zelos',
          theme: Blockly.Theme.defineTheme('rbxlTheme', {
            base: Blockly.Themes.Classic,
            componentStyles: {
              workspaceBackgroundColour: '#f4f6fa',
              toolboxBackgroundColour: '#ffffff',
              toolboxForegroundColour: '#39445a',
              flyoutBackgroundColour: '#ffffff',
              flyoutForegroundColour: '#39445a',
              flyoutOpacity: 1,
              scrollbarColour: '#b8c1d1',
              insertionMarkerColour: '#335cff',
              insertionMarkerOpacity: 0.25,
              scrollbarOpacity: 0.5,
              cursorColour: '#335cff'
            }
          }),
          trashcan: true,
          sounds: false,
          grid: { spacing: 24, length: 3, colour: '#dce2ec', snap: true },
          zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 1.6, minScale: 0.45, scaleSpeed: 1.1 },
          move: { scrollbars: true, drag: true, wheel: true }
        });
        workspaceRef.current = workspace;
        const savedState = initialStateRef.current;
        if (savedState && typeof savedState === 'object') {
          try { Blockly.serialization.workspaces.load(savedState, workspace); }
          catch (error) { console.warn('Blockly workspace could not be restored:', error); }
        }
        listener = (event) => {
          if (event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            try { onChangeRef.current?.(Blockly.serialization.workspaces.save(workspace)); }
            catch (error) { console.warn('Blockly workspace could not be saved:', error); }
          }, 250);
        };
        workspace.addChangeListener(listener);
        resizeObserver = new ResizeObserver(() => Blockly.svgResize(workspace));
        resizeObserver.observe(hostRef.current);
        Blockly.svgResize(workspace);
      } catch (error) {
        if (!disposed) console.error('Blocklyの読み込みに失敗しました:', error);
      }
    })();

    return () => {
      disposed = true;
      clearTimeout(timer);
      resizeObserver?.disconnect();
      if (workspace && listener) workspace.removeChangeListener(listener);
      workspace?.dispose();
      workspaceRef.current = null;
      BlocklyRef.current = null;
    };
  }, []);

  const lastExternalState = useRef(initialState);
  useEffect(() => {
    if (lastExternalState.current === initialState) return;
    lastExternalState.current = initialState;
    const workspace = workspaceRef.current;
    const Blockly = BlocklyRef.current;
    if (!workspace || !Blockly) return;
    try {
      const current = Blockly.serialization.workspaces.save(workspace);
      if (JSON.stringify(current) === JSON.stringify(initialState || {})) return;
      workspace.clear();
      if (initialState && typeof initialState === 'object') Blockly.serialization.workspaces.load(initialState, workspace);
    } catch (error) {
      console.warn('Blockly workspace could not be updated:', error);
    }
  }, [initialState]);

  return <div className="rbxl-blockly-editor" ref={hostRef} aria-label="Blocklyプログラミングワークスペース" />;
}
