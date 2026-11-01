import assert from 'node:assert/strict';
import { LOGICS, getLogicDefinition, getLogicDefaults, resolveLogicConfig } from '../src/logics/index.js';

assert.equal(LOGICS.length, 1);
assert.equal(getLogicDefinition('obby').name, 'Obby (障害物コース)');
assert.equal(getLogicDefinition('missing'), null);
assert.deepEqual(getLogicDefaults('obby'), { killY: -50 });
assert.deepEqual(resolveLogicConfig(null), { definition: null, params: {}, warning: null });

const loaded = resolveLogicConfig({ id: 'obby', version: 1, params: { killY: -120 } });
assert.equal(loaded.definition.id, 'obby');
assert.deepEqual(loaded.params, { killY: -120 });
assert.equal(loaded.warning, null);

const fallback = resolveLogicConfig({ id: 'obby', params: { killY: 'bad' } });
assert.deepEqual(fallback.params, { killY: -50 });

const bounded = resolveLogicConfig({ id: 'obby', params: { killY: -99999 } });
assert.deepEqual(bounded.params, { killY: -10000 });

const unknown = resolveLogicConfig({ id: 'user-script' });
assert.equal(unknown.definition, null);
assert.match(unknown.warning, /未対応/);
assert.deepEqual(unknown.params, {});

console.log('logics.test: OK');
