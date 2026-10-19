// Shared projects in SQLite: every change is an op, applied in arrival order inside one transaction (architecture §6.4).
// A deleted project (spec §3.11) is only marked deleted until it is restored or purged; for everything else here it is
// gone, so every route and later plan that reaches projects through this store answers 404 for it (ruling C7).

import { randomBytes } from 'node:crypto';
import type { Db, ProjectRow } from '../db/db.ts';
import type { PlanSettings } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { applyOp, defaultSettings, normalizeSettings, SETTINGS_VERSION, validateOp } from '../../shared/project/apply-op.ts';

/** Who the changes the planner makes on its own are recorded as (`migrateSettings`). */
export const PLANNER_UPDATE = 'Planner update';

export interface ProjectSummary { id: string; name: string; rev: number; target: StuffKey | null; updatedAt: string }
export interface DeletedSummary extends ProjectSummary { deletedAt: string; deletedBy: string }
export interface AppliedOp { rev: number; op: ProjectOp; by: string; at: string }

export class OpError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(message);
    this.name = 'OpError';
    this.index = index;
  }
}

export class ProjectStore {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(db: Db, deps?: { now?: () => Date; newId?: () => string }) {
    this.#db = db;
    this.#now = deps?.now ?? (() => new Date());
    this.#newId = deps?.newId ?? (() => randomBytes(8).toString('base64url').slice(0, 10));
  }

  create(name: string, by: string, settings?: Partial<PlanSettings>): Project {
    const at = this.#now().toISOString();
    const project: Project = {
      id: this.#newId(), name: name.trim(), createdAt: at, createdBy: by, rev: 0,
      settings: normalizeSettings({ ...defaultSettings(), ...settings }),
      world: { scanId: null, baseId: null }, placement: null, marks: {}, notes: [],
    };
    this.#db.insertProject({ id: project.id, name: project.name, rev: 0, state: JSON.stringify(project), createdAt: at, updatedAt: at });
    return project;
  }

  get(id: string): Project | null {
    const row = this.#live(id);
    return row ? this.#parse(row.state) : null;
  }

  /** The live projects, most recently changed first. */
  list(): ProjectSummary[] {
    return this.#db.listProjects().map((row) => this.#summary(row));
  }

  apply(id: string, ops: ProjectOp[], by: string): { project: Project; applied: AppliedOp[] } | null {
    return this.#db.tx(() => {
      const row = this.#live(id);
      if (!row) return null;
      ops.forEach((op, i) => {
        const reason = validateOp(op);
        if (reason !== null) throw new OpError(i, reason);
      });
      const at = this.#now().toISOString();
      let project = this.#parse(row.state);
      const applied: AppliedOp[] = [];
      for (const op of ops) {
        project = applyOp(project, op, by, at);
        applied.push({ rev: project.rev, op, by, at });
      }
      if (project.settings.mode === 'makeN' && !Number.isInteger(project.settings.amount)) {
        throw new OpError(ops.length - 1, 'amount must be an integer in Make N mode');
      }
      for (const a of applied) this.#db.appendOp(id, a.rev, JSON.stringify(a.op), by, at);
      this.#db.updateProject({ id, name: project.name, rev: project.rev, state: JSON.stringify(project), createdAt: row.createdAt, updatedAt: at });
      return { project, applied };
    });
  }

  /**
   * Brings every live project whose settings predate `SETTINGS_VERSION` to it, as `by` (architecture §11.32, the user's
   * answer to fix spec §10 question 2): one recorded settings op `{ routeDerived: true, settingsVersion: 2 }` each, so
   * projects stored while buying derived materials was the default plan supporting lines, as new ones do. A project at
   * the current version is never touched, so a later deliberate `routeDerived: false` sticks; running it again changes
   * nothing. A deleted project waits until it is restored and the next run. Returns the ids it changed, in list order.
   */
  migrateSettings(by: string): string[] {
    return this.#db.tx(() => {
      const changed: string[] = [];
      for (const row of this.#db.listProjects()) {
        if ((this.#parse(row.state).settings.settingsVersion ?? 0) >= SETTINGS_VERSION) continue;
        this.apply(row.id, [{ op: 'settings', patch: { routeDerived: true, settingsVersion: SETTINGS_VERSION } }], by);
        changed.push(row.id);
      }
      return changed;
    });
  }

  /**
   * Deletes the live project `id` for everyone, as `by` (restorable until it is purged); null when there is no live
   * project `id`, so deleting twice keeps the first deletion and its time. Its rev, state and ops stay as they are.
   */
  delete(id: string, by: string): DeletedSummary | null {
    return this.#db.tx(() => {
      const row = this.#live(id);
      if (!row) return null;
      const at = this.#now().toISOString();
      this.#db.softDeleteProject(id, by, at);
      return { ...this.#summary(row), deletedAt: at, deletedBy: by };
    });
  }

  /** Brings a deleted project back as it was; null when there is no such project (or it was purged). */
  restore(id: string): Project | 'not-deleted' | null {
    return this.#db.tx(() => {
      const row = this.#db.getProject(id);
      if (!row) return null;
      if (row.deletedAt === null) return 'not-deleted';
      const restored = this.#db.restoreProject(id);
      return restored ? this.#parse(restored.state) : null;
    });
  }

  /** The deleted projects not purged yet, newest deletion first. */
  listDeleted(): DeletedSummary[] {
    return this.#db.listDeletedProjects().map((row) => ({ ...this.#summary(row), deletedAt: row.deletedAt, deletedBy: row.deletedBy }));
  }

  /** The row of `id` unless it is missing or deleted. */
  #live(id: string): ProjectRow | undefined {
    const row = this.#db.getProject(id);
    return row?.deletedAt === null ? row : undefined;
  }

  #summary(row: ProjectRow): ProjectSummary {
    const p = this.#parse(row.state);
    return { id: row.id, name: row.name, rev: row.rev, target: p.settings.target, updatedAt: row.updatedAt };
  }

  #parse(state: string): Project {
    const p = JSON.parse(state) as Project;
    return { ...p, settings: normalizeSettings(p.settings) };
  }
}
