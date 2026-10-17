import { describe, expect, it } from 'vitest';
import { labelFromFile } from '../src/web/library.js';

describe('icon names from file names', () => {
  const images = [{ label: 'Sonarr 01', key: 'sonarr01-' }, { label: 'Audio book shelf 01', key: 'audiobookshelf01-' }];

  it('uses the icon-set name when the key is known, also with a mistyped size suffix', () => {
    expect(labelFromFile('sonarr01-512x512.png', images)).toBe('Sonarr 01');
    expect(labelFromFile('audiobookshelf01-512x1512.png', images)).toBe('Audio book shelf 01');
  });

  it('makes a name from the key otherwise', () => {
    expect(labelFromFile('deluge03-100x100.png', images)).toBe('Deluge 03');
    expect(labelFromFile('unifi-512x512.png')).toBe('Unifi');
    expect(labelFromFile('my_cool-icon.webp')).toBe('My Cool Icon');
  });
});
