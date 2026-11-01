import { obbyLogic } from './obby/index.js';

/** @type {import('./types.js').LogicDefinition[]} */
export const LOGICS = Object.freeze([obbyLogic]);
const byId = new Map(LOGICS.map((logic) => [logic.id, logic]));

export function getLogicDefinition(id) {
  return byId.get(id) || null;
}

export function getLogicDefaults(id) {
  const definition = getLogicDefinition(id);
  if (!definition) return {};
  return Object.fromEntries(Object.entries(definition.parameters).map(([key, field]) => [key, field.default]));
}

/** Resolve a manifest logic reference without evaluating code from the world file. */
export function resolveLogicConfig(manifestLogic) {
  if (!manifestLogic || !manifestLogic.id) return { definition: null, params: {}, warning: null };
  const definition = getLogicDefinition(manifestLogic.id);
  if (!definition) {
    return { definition: null, params: {}, warning: `未対応のゲームロジックです: ${manifestLogic.id}` };
  }
  const params = {};
  for (const [key, field] of Object.entries(definition.parameters)) {
    const value = manifestLogic.params?.[key];
    params[key] = typeof value === 'number' && Number.isFinite(value)
      ? Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, value))
      : field.default;
  }
  return { definition, params, warning: null };
}
