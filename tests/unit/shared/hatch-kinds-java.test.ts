import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPORT_HATCH_CLASSES, EXPORT_HATCH_KINDS } from '../../../src/shared/gt/hatch-kinds.ts';

// The exporter writes structure elements with its own copy of the hatch kinds (exporter-mod's HatchKinds.ALL); a kind,
// class or prefix that differs there would make the planner misread every export of that exporter.
const HATCH_KINDS_JAVA = 'exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/HatchKinds.java';

describe('the exporter\'s hatch kinds', () => {
  it('keeps the exporter\'s hatch kinds equal to the planner\'s', () => {
    const java = readFileSync(HATCH_KINDS_JAVA, 'utf8');
    const exporter = [...java.matchAll(/new Kind\("([a-z_]+)", "(\w+)", (?:null|"([^"]+)")\)/g)]
      .map((m) => ({ name: m[1], cls: m[2], metaPrefix: m[3] }));
    expect(exporter).toEqual(EXPORT_HATCH_KINDS.map((k) => ({ name: k, cls: EXPORT_HATCH_CLASSES[k].cls, metaPrefix: EXPORT_HATCH_CLASSES[k].metaPrefix })));
  });
});
