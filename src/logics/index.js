import { obbyLogic } from './obby/index.js';
import { createObbyRuntime } from './obby/runtime.js';

/** @type {import('./types.js').LogicDefinition[]} */
export const LOGICS = Object.freeze([obbyLogic]);
const byId = new Map(LOGICS.map((logic) => [logic.id, logic]));
const runtimes = new Map([['obby', createObbyRuntime]]);

export function getLogicDefinition(id) {
  return byId.get(id) || null;
}

export function getLogicDefaults(id) {
  const definition = getLogicDefinition(id);
  if (!definition) return {};
  return Object.fromEntries(Object.entries(definition.parameters).map(([key, field]) => [key, field.default]));
}

export function resolveLogicConfig(manifestLogic) {
  if (!manifestLogic || !manifestLogic.id) return { definition: null, params: {}, warning: null };
  const definition = getLogicDefinition(manifestLogic.id);
  if (!definition) return { definition: null, params: {}, warning: `未対応のゲームロジックです: ${manifestLogic.id}` };
  const params = {};
  for (const [key, field] of Object.entries(definition.parameters)) {
    const value = manifestLogic.params?.[key];
    params[key] = typeof value === 'number' && Number.isFinite(value)
      ? Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value))
      : field.default;
  }
  return { definition, params, warning: null };
}

/** ロジック固有の実行処理を生成する。エンジンはロジックIDごとの分岐を持たない。 */
export function createLogicRuntime(config, api) {
  const id = config?.definition?.id;
  const factory = id ? runtimes.get(id) : null;
  return factory ? factory(config, api) : null;
}
