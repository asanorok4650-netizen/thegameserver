// manifest.json の組み立て(変換・Studio用)。仕様: tgw-spec-v0.1 §3
import { worldBounds } from './worldjson.js';

export const MANIFEST_FORMAT_VERSION = '1.0';

/**
 * @param worldJson treeToWorldJson の worldJson
 * @param report    treeToWorldJson の report(source.ignored / approx に記録)
 * @param opts      { name, description, author, generator, logic:{id,version,params}, rules:{walkSpeed,jumpPower,gravity}, players:{max,sendHz}, sourceName }
 */
export function createManifest(worldJson, report, opts = {}) {
  const manifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    name: opts.name || 'Untitled',
    description: opts.description || '',
    author: opts.author || '',
    createdAt: opts.createdAt || new Date().toISOString(),
    generator: opts.generator || 'thegameserver',
    players: { max: 8, sendHz: 10, ...(opts.players || {}) },
    world: { file: 'world.json', partCount: worldJson.parts.length, bounds: worldBounds(worldJson) }
  };
  if (opts.rules && Object.keys(opts.rules).length) manifest.rules = { ...opts.rules }; // 既定値と違う項目だけ(game/rules.js の diffFromDefault)
  if (opts.logic) manifest.logic = { version: 1, params: {}, ...opts.logic };
  if (Array.isArray(opts.eventRules) && opts.eventRules.length) manifest.eventRules = opts.eventRules;
  if (report) {
    manifest.source = { kind: 'rbxl', name: opts.sourceName || '', ignored: report.ignored || {}, approx: report.approx || {} };
  }
  return manifest;
}
