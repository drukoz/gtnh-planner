import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { localTime } from '../../src/client/format.ts';
import { matchPath } from '../../src/client/router.ts';
import { ScanList, UploadStatus, WholeDimensions, WorldPage } from '../../src/client/views/WorldPage.tsx';
import { TOP_PAGES } from '../../src/client/views/top-pages.ts';
import { pickWorldFiles } from '../../src/client/world/pick-files.ts';
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
