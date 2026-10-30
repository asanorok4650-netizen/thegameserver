// パース済みrbxmツリーから、アクセサリ(Handle・メッシュ参照・アタッチメント)を取り出す。THREE非依存。
import { BODY_ATTACH } from '../avatar/rigs.js';

/** "rbxassetid://123" / "http://www.roblox.com/asset/?id=123" / ".../asset/123" → 123 */
export function parseAssetUri(s) {
  if (typeof s !== 'string' || !s) return null;
  const m = s.match(/rbxassetid:\/\/(\d+)/) || s.match(/[?&]id=(\d+)/) || s.match(/\/asset\/(\d+)/);
  return m ? Number(m[1]) : null;
}

const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const asColor = (p) => {
  const c = p.Color3uint8 || p.Color3 || p.Color;
  if (!Array.isArray(c) || c.length !== 3) return null;
  return c.some((v) => v > 1.0001) ? c.map((v) => v / 255) : c;
};

/**
 * @returns null | { name, handle:{kind:'meshpart'|'special', size, meshUri, textureUri, scale, offset, color, transparency},
 *                   attachment:{name,pos,rot}|null }
 */
export function extractAccessory(tree) {
  const all = [...tree.instances.values()];
  const acc = all.find((i) => i.className === 'Accessory' || i.className === 'Hat') || null;
  const handle = (acc ? acc.children : all).find((c) => c.props.Name === 'Handle' && /Part$/.test(c.className));
  if (!handle) return null;

  const h = { size: handle.props.Size || [1, 1, 1], color: asColor(handle.props), transparency: handle.props.Transparency || 0,
    meshUri: null, textureUri: null, scale: [1, 1, 1], offset: [0, 0, 0] };
  if (handle.className === 'MeshPart') {
    h.kind = 'meshpart';
    h.meshUri = handle.props.MeshId || handle.props.MeshContent || null;
    h.textureUri = handle.props.TextureID || handle.props.TextureId || handle.props.TextureContent || null;
  } else {
    const sm = handle.children.find((c) => c.className === 'SpecialMesh');
    if (!sm) return null;
    h.kind = 'special';
    h.meshUri = sm.props.MeshId || sm.props.MeshContent || null;
    h.textureUri = sm.props.TextureId || sm.props.TextureID || sm.props.TextureContent || null;
    h.scale = sm.props.Scale || [1, 1, 1];
    h.offset = sm.props.Offset || [0, 0, 0];
  }

  const atts = handle.children.filter((c) => c.className === 'Attachment');
  const pick = atts.find((a) => BODY_ATTACH[a.props.Name]) || null;
  let attachment = null;
  if (pick) {
    const cf = pick.props.CFrame || { pos: [0, 0, 0], rot: IDENT };
    attachment = { name: pick.props.Name, pos: cf.pos, rot: cf.rot || IDENT };
  } else if (acc && acc.className === 'Hat') { // 旧形式のHat(AttachmentPoint)
    attachment = { name: 'HatAttachment', pos: acc.props.AttachmentPos || [0, 0, 0], rot: IDENT };
  }
  return { name: (acc && acc.props.Name) || 'Accessory', handle: h, attachment };
}
