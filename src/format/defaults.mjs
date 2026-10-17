export const SCHEMA = 'proxmox-notes/1';

export const DESCRIPTION_ICON = 'fa-file-text-o';
export const NOTES_ICON = 'fa-sticky-note-o';
export const IMAGE_ALT = '[Icon]';
export const LINK_STYLE = 'text-decoration: none; color: #00f000;';

// The four sections of the original generator. The Services icon has no fa-fw; keep it that way.
export const SECTIONS = {
  creation: { title: 'Creation', icon: 'fa-exclamation-circle fa-fw' },
  network: { title: 'Network', icon: 'fa-sitemap fa-fw' },
  services: { title: 'Services', icon: 'fa-cogs' },
  access: { title: 'Access', icon: 'fa-key fa-fw' }
};

export function section(id, rows = []) {
  const known = SECTIONS[id];
  if (!known) {
    throw new Error(`Unknown section "${id}"; pass title and icon for a custom section`);
  }
  return { id, title: known.title, icon: known.icon, rows };
}

export function field(key, value) {
  return { type: 'field', key, value };
}

export function link(name, url) {
  return { type: 'link', name, url };
}

export function text(value) {
  return { type: 'text', text: value };
}

export function emptyDocument() {
  return {
    schema: SCHEMA,
    headerIcon: 'fa-linux',
    title: '',
    image: null,
    description: '',
    notes: '',
    sections: [section('creation'), section('network'), section('services'), section('access')]
  };
}
