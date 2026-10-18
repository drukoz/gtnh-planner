// Shared projects in SQLite: every change is an op, applied in arrival order inside one transaction (architecture §6.4).

import { randomBytes } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { PlanSettings } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import type { StuffKey } from '../../shared/keys.ts';
import { applyOp, defaultSettings, normalizeSettings, validateOp } from '../../shared/project/apply-op.ts';

export interface ProjectSummary { id: string; name: string; rev: number; target: StuffKey | null; updatedAt: string }
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
    const row = this.#db.getProject(id);
    return row ? this.#parse(row.state) : null;
  }

  list(): ProjectSummary[] {
    return this.#db.listProjects().map((row) => {
      const p = this.#parse(row.state);
      return { id: row.id, name: row.name, rev: row.rev, target: p.settings.target, updatedAt: row.updatedAt };
    });
  }

  apply(id: string, ops: ProjectOp[], by: string): { project: Project; applied: AppliedOp[] } | null {
    return this.#db.tx(() => {
      const row = this.#db.getProject(id);
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

  #parse(state: string): Project {
    const p = JSON.parse(state) as Project;
    return { ...p, settings: normalizeSettings(p.settings) };
  }
}
