import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapTab } from '../../src/client/views/MapTab.tsx';
import { PROJECT_TABS, tabFromHash } from '../../src/client/views/project-tabs.ts';
import { defaultSettings } from '../../src/shared/project/apply-op.ts';
import type { Project } from '../../src/shared/types/project.ts';

function projectWithWorld(scanId: string | null, baseId: string | null): Project {
  return {
    id: 'p1', name: 'Steel', createdAt: 't', createdBy: 'Ann', rev: 0, settings: defaultSettings(), world: { scanId, baseId },
    placement: null, marks: {}, notes: [],
  };
}

describe('MapTab (server-side render only: effects do not run)', () => {
  it('offers a scan picker and a link to the World page when the project has no scan', () => {
    const html = renderToStaticMarkup(<MapTab project={projectWithWorld(null, null)} plan={null} send={() => {}} me="Ann" />);
    expect(html).toContain('Choose a world scan');
    expect(html).toContain('href="/world"');
    expect(html).toContain('Scan the world');
    const label = /<label for="([^"]+)"[^>]*>World scan<\/label><select id="([^"]+)"/.exec(html);   // labelled exactly "World scan"
    expect(label?.[1]).toBe(label?.[2]);
    expect(html).toMatch(/<select[^>]*><option value=""[^>]*>Loading the scans/);                  // its first option is a placeholder
    expect(html).not.toContain('>Base<');                                                           // the base select waits for a scan
  });

  it('loads the project scan before showing the map', () => {
    const html = renderToStaticMarkup(<MapTab project={projectWithWorld('20261017T120000Z-000016', '0:0:0')} plan={null} send={() => {}} me="Ann" />);
    expect(html).toContain('Loading the world scan');
    expect(html).not.toContain('Choose a world scan');
  });

  it('is the first project tab', () => expect(PROJECT_TABS[0]).toMatchObject({ id: 'map', label: 'Map' }));

  it('opens the map when no tab is named and keeps the other tabs in their order', () => {
    expect(tabFromHash('')).toBe('map');
    expect(tabFromHash('#flow')).toBe('flow');
    const ids = PROJECT_TABS.map((t) => t.id);   // relative order only: Plan 5 inserts 3d after map
    expect(ids.filter((id) => id === 'flow' || id === 'materials' || id === 'notes')).toEqual(['flow', 'materials', 'notes']);
  });
});
