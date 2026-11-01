/**
 * Built-in game logic metadata shared by Studio and the game loader.
 * Logic definitions contain declarative configuration only; executable runtime
 * behavior is intentionally kept out of .tgw files.
 *
 * @typedef {{ id: string, label: string, description?: string }} LogicTag
 * @typedef {{ type: 'number', label: string, description?: string, default: number, min?: number, max?: number, step?: number }} NumberParameter
 * @typedef {{ id: string, name: string, description: string, version: number,
 *   parameters: Record<string, NumberParameter>, tags: LogicTag[] }} LogicDefinition
 */
export {};
