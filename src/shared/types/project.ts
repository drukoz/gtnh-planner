// Shared projects and the ops that change them: architecture §6.4. The ProjectOp union is append-only (Plans 4 and 5
// add members, each with a case in `applyOp` and `validateOp`).
// Pure TypeScript shared by server and browser: nothing from node:* may be imported here.

import type { PlanSettings } from './plan.ts';

export interface Note { id: string; text: string; by: string; at: string; pin?: { dim: number; x: number; y: number; z: number } }
export interface Mark { by: string; at: string }

export interface Project {
  id: string; name: string; createdAt: string; createdBy: string; rev: number;
  settings: PlanSettings;
  world: { scanId: string | null; baseId: string | null };
  placement: { origin: [number, number, number]; rotation: 0 | 90 | 180 | 270 } | null;   // used by Plan 5
  marks: Record<string, Mark>;           // row ids: "build:<key>", "run:<key>", "step:<buildStepId>"
  notes: Note[];
}

export type ProjectOp =
  | { op: 'rename'; name: string }
  | { op: 'settings'; patch: Partial<PlanSettings> }
  | { op: 'mark'; row: string; on: boolean }
  | { op: 'addNote'; note: Omit<Note, 'by' | 'at'> }
  | { op: 'editNote'; id: string; text: string }
  | { op: 'deleteNote'; id: string }
  | { op: 'world'; scanId: string | null; baseId: string | null }
  | { op: 'placement'; origin: [number, number, number]; rotation: 0 | 90 | 180 | 270 } | { op: 'clearPlacement' };
