// P2P v2 binary state protocol. This module is browser/Three.js independent.
export const STATE_BYTES = 15;
export const BATCH_HEADER_BYTES = 9;
export const BATCH_MAGIC = 0x4252;
export const BINARY_VERSION = 1;
export const PACKET_STATE_BATCH = 1;
export const MAX_BATCH_STATES = 32;
const UINT16_MOD = 0x10000;
const DEFAULT_SPEED_RANGE = 31.75;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const TWO_PI = Math.PI * 2;

function readBounds(bounds) {
  const min = bounds?.min, max = bounds?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) throw new TypeError('bounds must contain min[3] and max[3]');
  for (let i = 0; i < 3; i++) if (!finite(min[i]) || !finite(max[i]) || max[i] <= min[i]) throw new RangeError('invalid world bounds');
  return { min, max };
}
function normalizeState(state) {
  const a = Array.isArray(state) ? state : [state?.x, state?.y, state?.z, state?.yaw ?? state?.heading, state?.speed, state?.grounded];
  if (a.length !== 6 || !a.slice(0, 5).every(finite)) throw new TypeError('invalid player state');
  return { x: a[0], y: a[1], z: a[2], yaw: a[3], speed: a[4], grounded: !!a[5] };
}
function qpos(v, min, max) {
  if (v < min || v > max) throw new RangeError('position is outside world bounds');
  return Math.round(((v - min) / (max - min)) * 65535);
}
function dpos(v, min, max) { return min + (v / 65535) * (max - min); }
function qyaw(yaw) { return Math.round((((yaw % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI * 65535) & 0xffff; }

/** Encode [x,y,z,headingRadians,speed,grounded] in a 15-byte record. */
export function encodeState(record, bounds, options = {}) {
  const world = readBounds(bounds), s = normalizeState(record?.state);
  const peerId = record?.peerId, seq = record?.seq;
  if (!Number.isInteger(peerId) || peerId < 1 || peerId > 65535) throw new RangeError('peerId must be 1..65535');
  if (!Number.isInteger(seq) || seq < 0 || seq > 65535) throw new RangeError('seq must be uint16');
  const speedRange = options.speedRange ?? DEFAULT_SPEED_RANGE;
  if (!finite(speedRange) || speedRange <= 0 || speedRange > 127.75 || s.speed < -speedRange || s.speed > speedRange) throw new RangeError('speed is outside the configured range');
  const pitch = record.pitchRadians ?? record.pitch ?? 0;
  if (!finite(pitch) || pitch < -Math.PI / 2 || pitch > Math.PI / 2) throw new RangeError('pitch must be between -PI/2 and PI/2');
  const buffer = new ArrayBuffer(STATE_BYTES), view = new DataView(buffer);
  view.setUint16(0, peerId, true); view.setUint16(2, seq, true);
  view.setUint16(4, qpos(s.x, world.min[0], world.max[0]), true);
  view.setUint16(6, qpos(s.y, world.min[1], world.max[1]), true);
  view.setUint16(8, qpos(s.z, world.min[2], world.max[2]), true);
  view.setUint16(10, qyaw(s.yaw), true);
  view.setInt8(12, Math.round(pitch / (Math.PI / 2) * 127));
  view.setInt8(13, Math.round(s.speed / speedRange * 127));
  view.setUint8(14, s.grounded ? 1 : 0);
  return new Uint8Array(buffer);
}

/** Decode one 15-byte record. Invalid records return null. */
export function decodeState(bytes, bounds, options = {}) {
  try {
    const world = readBounds(bounds);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== STATE_BYTES) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), peerId = v.getUint16(0, true), flags = v.getUint8(14);
    if (!peerId || (flags & 0xfe)) return null;
    const speedRange = options.speedRange ?? DEFAULT_SPEED_RANGE;
    if (!finite(speedRange) || speedRange <= 0 || speedRange > 127.75) return null;
    return {
      peerId, seq: v.getUint16(2, true),
      state: [
        dpos(v.getUint16(4, true), world.min[0], world.max[0]),
        dpos(v.getUint16(6, true), world.min[1], world.max[1]),
        dpos(v.getUint16(8, true), world.min[2], world.max[2]),
        v.getUint16(10, true) / 65535 * TWO_PI,
        v.getInt8(13) / 127 * speedRange, flags & 1
      ],
      pitch: v.getInt8(12) / 127 * (Math.PI / 2)
    };
  } catch { return null; }
}

/** uint16 sequence comparison with wraparound. */
export function isNewerUint16(candidate, previous) {
  if (![candidate, previous].every((n) => Number.isInteger(n) && n >= 0 && n <= 65535)) return false;
  const delta = (candidate - previous + UINT16_MOD) % UINT16_MOD;
  return delta > 0 && delta < 0x8000;
}

/** Batch header: magic(2), version(1), type(1), roomEpoch(4), count(1), then 15-byte records. */
export function encodeStateBatch(records, bounds, roomEpoch, options = {}) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_BATCH_STATES) throw new RangeError('batch must contain 1..32 states');
  if (!Number.isInteger(roomEpoch) || roomEpoch < 0 || roomEpoch > 0xffffffff) throw new RangeError('roomEpoch must be uint32');
  const buffer = new ArrayBuffer(BATCH_HEADER_BYTES + records.length * STATE_BYTES), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  view.setUint16(0, BATCH_MAGIC, true); view.setUint8(2, BINARY_VERSION); view.setUint8(3, PACKET_STATE_BATCH);
  view.setUint32(4, roomEpoch, true); view.setUint8(8, records.length);
  records.forEach((r, i) => bytes.set(encodeState(r, bounds, options), BATCH_HEADER_BYTES + i * STATE_BYTES));
  return bytes;
}
export function decodeStateBatch(bytes, bounds, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < BATCH_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint8(8);
  if (view.getUint16(0, true) !== BATCH_MAGIC || view.getUint8(2) !== BINARY_VERSION || view.getUint8(3) !== PACKET_STATE_BATCH ||
      count < 1 || count > MAX_BATCH_STATES || bytes.byteLength !== BATCH_HEADER_BYTES + count * STATE_BYTES) return null;
  const states = [];
  for (let i = 0; i < count; i++) {
    const s = decodeState(bytes.subarray(BATCH_HEADER_BYTES + i * STATE_BYTES, BATCH_HEADER_BYTES + (i + 1) * STATE_BYTES), bounds, options);
    if (!s) return null;
    states.push(s);
  }
  return { roomEpoch: view.getUint32(4, true), states };
}
