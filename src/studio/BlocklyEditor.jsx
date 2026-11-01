import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly';
import 'blockly/blocks';
import './blockly-editor.css';

let registered = false;
function registerBlocks() {
  if (registered) return;
  registered = true;
  const definitions = [
    { type: 'rbxl_when_start', message0: 'ゲームが始まったとき', hat: 'cap', nextStatement: null, colour: 25 },
    { type: 'rbxl_when_touch', message0: 'パーツ %1 に触れたとき', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }], hat: 'cap', nextStatement: null, colour: 25 },
    { type: 'rbxl_wait', message0: '%1 秒待つ', args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_if', message0: 'もし %1 なら %2', args0: [{ type: 'input_value', name: 'CONDITION', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_repeat', message0: '%1 回繰り返す %2', args0: [{ type: 'field_number', name: 'TIMES', value: 10, min: 0, max: 1000, precision: 1 }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: 40 },
    { type: 'rbxl_add_score', message0: 'スコアを %1 増やす', args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_show_message', message0: 'メッセージ %1 を表示', args0: [{ type: 'field_input', name: 'TEXT', text: 'こんにちは！' }], previousStatement: null, nextStatement: null, colour: 145 },
    { type: 'rbxl_set_variable', message0: '変数 %1 を %2 にする', args0: [{ type: 'field_input', name: 'NAME', text: 'coins' }, { type: 'input_value', name: 'VALUE', check: 'Number' }], previousStatement: null, nextStatement: null, colour: 330 },
    { type: 'rbxl_compare', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'field_dropdown', name: 'OP', options: [['=', 'EQ'], ['>', 'GT'], ['<', 'LT'], ['≧', 'GTE'], ['≦', 'LTE']] }, { type: 'input_value', name: 'B', check: 'Number' }], output: 'Boolean', colour: 210 },
    { type: 'rbxl_number', message0: '%1', args0: [{ type: 'field_number', name: 'VALUE', value: 0 }], output: 'Number', colour: 210 },
    { type: 'rbxl_part_visible', message0: 'パーツ %1 を表示 %2', args0: [{ type: 'field_input', name: 'PART', text: 'Part' }, { type: 'field_checkbox', name: 'VISIBLE', checked: true }], previousStatement: null, nextStatement: null, colour: 145 }
  ];
  Blockly.common.defineBlocksWithJsonArray(definitions);
}

const toolbox = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'イベント', colour: '#e6a23c', contents: [
      { kind: 'block', type: 'rbxl_when_start' }, { kind: 'block', type: 'rbxl_when_touch' }
    ] },
    { kind: 'category', name: '制御', colour: '#d6a23a', contents: [
      { kind: 'block', type: 'rbxl_wait' }, { kind: 'block', type: 'rbxl_if' }, { kind: 'block', type: 'rbxl_repeat' }
    ] },
    { kind: 'category', name: 'アクション', colour: '#43a879', contents: [
      { kind: 'block', type: 'rbxl_add_score' }, { kind: 'block', type: 'rbxl_show_message' }, { kind: 'block', type: 'rbxl_part_visible' }
    ] },
    { kind: 'category', name: '変数', colour: '#a879ce', custom: 'VARIABLE' },
    { kind: 'category', name: '計算・条件', colour: '#5796d2', contents: [
      { kind: 'block', type: 'rbxl_number' }, { kind: 'block', type: 'rbxl_compare' },
      { kind: 'block', type: 'math_number' }, { kind: 'block', type: 'logic_compare' }, { kind: 'block', type: 'logic_boolean' }
    ] },
    { kind: 'category', name: '標準ブロック', colour: '#8793a5', contents: [
      { kind: 'block', type: 'controls_if' }, { kind: 'block', type: 'controls_repeat_ext' },
      { kind: 'block', type: 'math_arithmetic' }, { kind: 'block', type: 'text' }
    ] }
  ]
};

export default function BlocklyEditor({ initialState, onChange }) {
  const hostRef = useRef(null);
  const workspaceRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    registerBlocks();
    const workspace = Blockly.inject(hostRef.current, {
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
    if (initialState && typeof initialState === 'object') {
      try { Blockly.serialization.workspaces.load(initialState, workspace); }
      catch (error) { console.warn('Blockly workspace could not be restored:', error); }
    }
    let timer;
    const listener = (event) => {
      if (event.isUiEvent || event.type === Blockly.Events.FINISHED_LOADING) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { onChangeRef.current?.(Blockly.serialization.workspaces.save(workspace)); }
        catch (error) { console.warn('Blockly workspace could not be saved:', error); }
      }, 250);
    };
    workspace.addChangeListener(listener);
    const resizeObserver = new ResizeObserver(() => Blockly.svgResize(workspace));
    resizeObserver.observe(hostRef.current);
    Blockly.svgResize(workspace);
    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  const lastExternalState = useRef(initialState);
  useEffect(() => {
    if (lastExternalState.current === initialState) return;
    lastExternalState.current = initialState;
    const workspace = workspaceRef.current;
    if (!workspace) return;
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
