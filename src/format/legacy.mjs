import { field, link, SCHEMA, section } from './defaults.mjs';

// The resource defaults of the original generator's select.json.
export const LEGACY_RESOURCES = { imageFqdn: '', imageWidth: 100, imageHeight: 100 };

export function legacyResources(selectJson) {
  const r = selectJson?.['proxmox-notes']?.resources ?? {};
  return {
    imageFqdn: r['image fqdn'] ?? LEGACY_RESOURCES.imageFqdn,
    imageWidth: Number(r['image width'] ?? LEGACY_RESOURCES.imageWidth),
    imageHeight: Number(r['image height'] ?? LEGACY_RESOURCES.imageHeight)
  };
}

export function legacyImageUrl(key, resources) {
  return `${resources.imageFqdn}/${key}${resources.imageWidth}x${resources.imageHeight}.png`;
}

/**
 * Converts a file saved by the original Notes Generator ("Save" button) into a document.
 * Shape: { h: { s1, t1, s2, m1, m2 }, sections: { creation, network, access: [{k, v}], services: [{n, u}] } }
 */
export function fromLegacyJson(saved, resources = LEGACY_RESOURCES) {
  if (!saved || typeof saved !== 'object' || !saved.h || !saved.sections) {
    throw new Error('Not a Notes Generator file: expected "h" and "sections"');
  }
  const { h, sections } = saved;
  const key = (h.s2 ?? '').trim() || 'default';
  const fields = rows => (rows ?? []).map(r => field(r.k ?? '', r.v ?? ''));
  return {
    schema: SCHEMA,
    headerIcon: h.s1 || 'fa-linux',
    title: h.t1 ?? '',
    image: {
      src: legacyImageUrl(key, resources),
      width: resources.imageWidth,
      height: resources.imageHeight,
      key
    },
    description: h.m1 ?? '',
    notes: h.m2 ?? '',
    sections: [
      section('creation', fields(sections.creation)),
      section('network', fields(sections.network)),
      section('services', (sections.services ?? []).map(s => link(s.n ?? '', s.u ?? ''))),
      section('access', fields(sections.access))
    ].filter(s => s.rows.length > 0)
  };
}
