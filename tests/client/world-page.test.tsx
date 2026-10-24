import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { localTime } from '../../src/client/format.ts';
import { matchPath } from '../../src/client/router.ts';
import { SmartUploadPanel } from '../../src/client/views/SmartUploadPanel.tsx';
import { ScanList, smartView, UploadStatus, WholeDimensions, WorldPage, type PickedWorld, type SmartWork } from '../../src/client/views/WorldPage.tsx';
import { TOP_PAGES } from '../../src/client/views/top-pages.ts';
import { pickWorldFiles } from '../../src/client/world/pick-files.ts';
import type { Hotspot, SmartPlan } from '../../src/client/world/smart.ts';
import type { WorldScanListItem } from '../../src/shared/types/api.ts';

const PICK = pickWorldFiles([
  { path: 'World/level.dat', size: 300 }, { path: 'World/region/r.0.0.mca', size: 4096 }, { path: 'World/region/r.-1.0.mca', size: 8192 },
  { path: 'World/DIM-1/region/r.-1.0.mca', size: 1000 }, { path: 'World/DIM7/region/r.0.0.mca', size: 3 * 1_048_576 }, { path: 'World/playerdata/a.dat', size: 9 },
]);
const IDLE = { running: false, progress: null, error: null, outcome: null };

function scanItem(id: string, state: WorldScanListItem['state'], over: Partial<WorldScanListItem> = {}): WorldScanListItem {
  return { id, state, progress: 0.4, message: `Reading ${id}`, startedAt: '2026-10-17T12:00:00.000Z', source: { kind: 'server' }, levelName: null, ...over };
}

describe('WorldPage (server-side render: effects do not run)', () => {
  it('renders the three sections and the pickers', () => {
    const html = renderToStaticMarkup(<WorldPage />);
    for (const t of ['Server folder', 'Scans', 'Upload a world', 'data-testid="world-folder-input"', 'webkitdirectory', 'data-testid="world-zip-input"']) expect(html).toContain(t);
    expect(html).not.toContain('world.zip');   // a zip is read in the browser, never uploaded whole
  });

  it('offers a multi-file folder picker and a zip picker', () => {
    const html = renderToStaticMarkup(<WorldPage />);
    expect(html).toMatch(/<input type="file" webkitdirectory="" multiple="" data-testid="world-folder-input"/);
    expect(html).toMatch(/<input type="file" accept=".zip" data-testid="world-zip-input"/);
  });

  it('explains that scans never touch the live server and that a project picks its scan on the Map tab', () => {
    const html = renderToStaticMarkup(<WorldPage />);
    expect(html).toContain('never touch the live server');
    expect(html).toContain('Map tab');
  });

  it('is the World top page, after the projects', () => {
    expect(TOP_PAGES.map((p) => p.path)).toEqual(['/', '/world']);
    expect(TOP_PAGES.at(-1)).toEqual({ path: '/world', label: 'World', component: WorldPage });
    expect(matchPath('/world')).toEqual({ name: 'top', path: '/world' });
  });
});

describe('ScanList', () => {
  const scans = [
    scanItem('20261017T130000Z-000003', 'running', { source: { kind: 'upload', uploadId: 'a'.repeat(32) } }),
    scanItem('20261017T120000Z-000002', 'queued', { progress: 0, message: 'Queued', source: { kind: 'backup', file: '2026-10-17-11-30.zip' } }),
    scanItem('20261017T110000Z-000001', 'done', { progress: 1, message: 'Done: 1 base, 12 machines', levelName: 'World', finishedAt: '2026-10-17T11:05:00.000Z' }),
    scanItem('20261017T100000Z-000000', 'failed', { progress: 0, message: 'Cancelled' }),
  ];

  it('lists every scan with its state, start time, source, progress and message, newest first', () => {
    const html = renderToStaticMarkup(<ScanList scans={scans} error={null} onCancel={() => {}} />);
    expect([...html.matchAll(/data-testid="scan-row" data-state="(\w+)"/g)].map((m) => m[1])).toEqual(['running', 'queued', 'done', 'failed']);
    for (const t of [localTime('2026-10-17T12:00:00.000Z'), 'upload', 'backup 2026-10-17-11-30.zip', 'server folder', '1 base, 12 machines', 'Cancelled', 'World'])
      expect(html).toContain(t);
    expect(html).toContain('<progress max="1" value="0.4"');
    expect(html.match(/<progress/g)).toHaveLength(4);
  });

  it('names the state once: in the message when it says it, else beside the start time', () => {
    const html = renderToStaticMarkup(<ScanList scans={scans} error={null} onCancel={() => {}} />);
    const rows = html.split('data-testid="scan-row"').slice(1);
    expect(rows.map((r) => /<strong>(\w+)<\/strong>/.exec(r)?.[1] ?? null)).toEqual(['Running', null, null, 'Failed']);   // "Queued", "Done: …"
  });

  it('offers Cancel only while a scan is queued or running', () => {
    const html = renderToStaticMarkup(<ScanList scans={scans} error={null} onCancel={() => {}} />);
    const rows = html.split('data-testid="scan-row"').slice(1);
    expect(rows.map((r) => r.includes('>Cancel</button>'))).toEqual([true, true, false, false]);
  });

  it('shows the warnings of a finished scan under its row', () => {
    const warned = scanItem('20261017T140000Z-000004', 'done', {
      progress: 1, message: 'Done: 1 base, 3 machines (2 chunks skipped)', warnings: ['Scanned without a recipe export: machines are unknown', '1 boiler with unknown steam output'],
    });
    const html = renderToStaticMarkup(<ScanList scans={[warned, ...scans]} error={null} onCancel={() => {}} />);
    const rows = html.split('data-testid="scan-row"').slice(1);
    expect(rows.map((r) => r.includes('data-testid="scan-row-notes"'))).toEqual([true, false, false, false, false]);
    expect(rows[0]).toMatch(/Scan notes[^]*Scanned without a recipe export: machines are unknown[^]*1 boiler with unknown steam output/);
    expect(rows[0]).toContain('2 chunks skipped');   // the skipped chunks stay in the message
  });

  it('says when there are no scans yet, while it loads, and when listing fails', () => {
    expect(renderToStaticMarkup(<ScanList scans={[]} error={null} onCancel={() => {}} />)).toContain('No scans yet');
    expect(renderToStaticMarkup(<ScanList scans={null} error={null} onCancel={() => {}} />)).toContain('Loading');
    expect(renderToStaticMarkup(<ScanList scans={null} error="The server answered 500" onCancel={() => {}} />)).toContain('The server answered 500');
  });
});

describe('WholeDimensions', () => {
  it('lists the dimensions with file counts and sizes, Overworld ticked, and the total', () => {
    const html = renderToStaticMarkup(<WholeDimensions pick={PICK} chosen={[0]} upload={IDLE} onChoose={() => {}} onUpload={() => {}} onStop={() => {}} />);
    expect(html).toMatch(/^<details[^>]*><summary[^>]*>Advanced: whole dimensions<\/summary>/);
    expect(html).toMatch(/<input type="checkbox" checked=""[^>]*\/>Overworld/);
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>Nether/);
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>DIM7/);
    for (const t of ['2 files, 12 KB', '1 file, 1 KB', '1 file, 3.0 MB', 'level.dat and 2 region files, 13 KB', 'data-testid="upload-dims-button"', 'Upload whole dimensions and scan'])
      expect(html).toContain(t);
    expect(html).not.toContain('playerdata');
  });

  it('cannot upload without a dimension or while an upload runs', () => {
    const none = renderToStaticMarkup(<WholeDimensions pick={PICK} chosen={[]} upload={IDLE} onChoose={() => {}} onUpload={() => {}} onStop={() => {}} />);
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*data-testid="upload-dims-button"/);
    const progress = { done: 1, total: 3, bytesDone: 300, bytesTotal: 12_588, current: 'region/r.0.0.mca' };
    const busy = renderToStaticMarkup(
      <WholeDimensions pick={PICK} chosen={[0]} upload={{ ...IDLE, running: true, progress }} onChoose={() => {}} onUpload={() => {}} onStop={() => {}} />);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*data-testid="upload-dims-button"/);
    expect(busy).toContain('<progress max="12588" value="300"');
    expect(busy).toContain('Stop');
  });
});

describe('UploadStatus', () => {
  it('shows progress, the file being sent, errors in plain words and the outcome', () => {
    const progress = { done: 2, total: 5, bytesDone: 2 * 1_048_576, bytesTotal: 6 * 1_048_576, current: 'DIM-1/region/r.0.0.mca' };
    const running = renderToStaticMarkup(<UploadStatus upload={{ ...IDLE, running: true, progress }} onStop={() => {}} />);
    for (const t of ['2 of 5 files', '2.0 MB of 6.0 MB', 'DIM-1/region/r.0.0.mca', '>Stop upload</button>']) expect(running).toContain(t);
    const failed = renderToStaticMarkup(<UploadStatus upload={{ ...IDLE, progress, error: 'region/r.0.0.mca: too large' }} onStop={() => {}} />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('region/r.0.0.mca: too large');
    expect(failed).not.toContain('Stop upload');
    expect(renderToStaticMarkup(<UploadStatus upload={{ ...IDLE, outcome: 'Sent 3 files. The scan is listed under Scans.' }} onStop={() => {}} />))
      .toContain('The scan is listed under Scans.');
    expect(renderToStaticMarkup(<UploadStatus upload={IDLE} onStop={() => {}} />)).toBe('');
  });
});

// useSmartPlan shows `smartView` of what it has worked out (its effects do not run in a server-side render).
describe('useSmartPlan: what the smart upload shows', () => {
  const picked = (label: string): PickedWorld => ({ label, pick: PICK, blob: async () => new Blob([]), close: async () => {} });
  const HOTSPOTS: Hotspot[] = [{ dim: 0, cx: 0, cz: 0, why: 'spawn' }];
  const plan = (chunks: number): SmartPlan => ({
    items: [{ rel: 'level.dat', size: 300, blob: async () => new Blob([]) }, { rel: 'region/r.0.0.mca', size: 4096, blob: async () => new Blob([]) }],
    areas: [{ dim: 0, x: 0, z: 0, why: 'spawn', chunks }], bytes: 4396, chunks,
  });
  const WORLD = picked('World');
  /** The plan for radius 8 is in; the user has just moved the slider. */
  const AT_8: SmartWork = { reading: null, found: { world: WORLD, hotspots: HOTSPOTS }, planned: { hotspots: HOTSPOTS, radius: 8, plan: plan(289) }, error: null };

  it('shows a plan only for the radius it was made for, so a stale plan is never shown or sent', () => {
    expect(smartView(AT_8, WORLD, 8).plan).toBe(AT_8.planned!.plan);
    expect(smartView(AT_8, WORLD, 4)).toEqual({ reading: null, plan: null, error: null });   // radius 4 is still being planned
    const html = renderToStaticMarkup(
      <SmartUploadPanel reading={null} plan={smartView(AT_8, WORLD, 4).plan} radius={4} busy={false} onRadius={() => {}} onUpload={() => {}} />);
    expect(html).toContain('Working out what to send');
    expect(html).toContain('4 chunks (64 blocks) around each spot');
    expect(html).not.toContain('data-testid="smart-area"');
    expect(html).not.toContain('data-testid="smart-total"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="upload-button"/);
  });

  it('shows the plan again once it is made for the new radius', () => {
    const at4: SmartWork = { ...AT_8, planned: { hotspots: HOTSPOTS, radius: 4, plan: plan(81) } };
    expect(smartView(at4, WORLD, 4).plan?.chunks).toBe(81);
    expect(smartView(at4, WORLD, 8).plan).toBeNull();
  });

  it('shows nothing of an older pick, nor a plan made from other hotspots', () => {
    const older = picked('Old');
    const stale: SmartWork = {
      reading: { world: older, done: 1, total: 3 }, found: { world: older, hotspots: HOTSPOTS }, planned: AT_8.planned, error: { world: older, message: 'Could not read the world: x' },
    };
    expect(smartView(stale, WORLD, 8)).toEqual({ reading: null, plan: null, error: null });
    expect(smartView(stale, older, 8)).toEqual({ reading: { done: 1, total: 3 }, plan: AT_8.planned!.plan, error: 'Could not read the world: x' });
    expect(smartView({ ...AT_8, found: { world: WORLD, hotspots: [...HOTSPOTS] } }, WORLD, 8).plan).toBeNull();   // found again: plan anew
  });
});

// The Machine GUI restyle (restyle plan Phase 1 Task 9): the page's inline styles are classes of the stylesheet now, and nothing inline is left.
describe('the Machine GUI World page', () => {
  it('draws the page, its three sections and its pickers with the stylesheet, the pickers neither wrapped nor reordered', () => {
    const html = renderToStaticMarkup(<WorldPage />);
    expect(html).not.toContain('style=');
    expect(html).toContain('<main class="page world-page"><h1>World</h1>');
    expect(html.match(/<section class="card world-section" aria-labelledby=/g)).toHaveLength(3);
    expect(html).toMatch(/<div class="row world-pickers"><label class="field"><span>World folder \(recommended\)<\/span><input type="file" webkitdirectory="" multiple="" data-testid="world-folder-input"[^>]*\/><\/label><label class="field"><span>Or a zip of the world folder<\/span><input type="file" accept="\.zip" data-testid="world-zip-input"[^>]*\/><\/label><\/div>/);
    expect(html).toContain('<footer class="muted">Scans never touch the live server');
  });

  it('sets the scans in a list of rows, each with a head, and the warnings of a finished one under it', () => {
    const warned = scanItem('20261017T140000Z-000004', 'done', { progress: 1, message: 'Done: 1 base, 3 machines', warnings: ['1 boiler with unknown steam output'] });
    const running = scanItem('20261017T130000Z-000003', 'running');
    const html = renderToStaticMarkup(<ScanList scans={[warned, running]} error={null} onCancel={() => {}} />);
    expect(html).not.toContain('style=');
    expect(html).toContain('<ul class="cards scan-list">');
    expect(html.match(/<li class="scan-row" data-testid="scan-row" data-state="(done|running)">/g)).toHaveLength(2);
    expect(html.match(/<div class="row scan-row-head">/g)).toHaveLength(2);
    expect(html).toContain('<div class="small scan-notes" data-testid="scan-row-notes"><strong>Scan notes</strong><ul><li>1 boiler with unknown steam output</li></ul></div>');
    // the state's chip is the bare strong the page's tests read, and the bar takes its width from the stylesheet
    expect(html).toContain('<strong>Running</strong>');
    expect(html).toContain('<progress max="1" value="0.4" aria-label="Running, 40%"></progress>');
  });

  it('opens the whole-dimensions disclosure into a body, its dimensions in a fieldset of the settings', () => {
    const html = renderToStaticMarkup(<WholeDimensions pick={PICK} chosen={[0]} upload={IDLE} onChoose={() => {}} onUpload={() => {}} onStop={() => {}} />);
    expect(html).not.toContain('style=');
    expect(html).toMatch(/^<details class="disclosure"><summary>Advanced: whole dimensions<\/summary><div class="disclosure-body"><p class="muted">Sends level\.dat/);
    expect(html).toContain('<fieldset class="choice"><legend class="visually-hidden">Dimensions to upload</legend>');
  });

  it('shows an upload\'s progress and its end in a column of its own, and nothing before one', () => {
    const progress = { done: 2, total: 5, bytesDone: 2 * 1_048_576, bytesTotal: 6 * 1_048_576, current: 'DIM-1/region/r.0.0.mca' };
    for (const upload of [{ ...IDLE, running: true, progress }, { ...IDLE, error: 'too large' }, { ...IDLE, outcome: 'Sent 3 files.' }]) {
      const html = renderToStaticMarkup(<UploadStatus upload={upload} onStop={() => {}} />);
      expect(html).toMatch(/^<div class="upload-status">/);
      expect(html).not.toContain('style=');
    }
    expect(renderToStaticMarkup(<UploadStatus upload={IDLE} onStop={() => {}} />)).toBe('');
  });
});
