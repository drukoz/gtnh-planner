// The group's projects, newest change first (spec §3.11: each build is a project with its own link), and a form to
// start a new one.

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { MAX_NAME_LENGTH, validateOp } from '../../shared/project/apply-op.ts';
import type { CreateProjectBody, ProjectListEntry, StuffInfo } from '../../shared/types/api.ts';
import type { Project } from '../../shared/types/project.ts';
import { apiGet, apiPost, messageOf } from '../api/client.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { localTime } from '../format.ts';
import { followLink, navigate } from '../router.ts';

/** Display names of the projects' targets; a key the pack cannot name (or no export yet) shows as the key. */
function useTargetNames(projects: ProjectListEntry[] | null): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const keys = [...new Set((projects ?? []).flatMap((p) => (p.target === null ? [] : [p.target])))].sort();
  const wanted = keys.join('\n');
  useEffect(() => {
    let live = true;
    for (const key of wanted === '' ? [] : wanted.split('\n')) {
      apiGet<StuffInfo>(`/api/pack/stuff/${encodeURIComponent(key)}`).then(
        (info) => {
          if (live) setNames((n) => ({ ...n, [key]: info.name }));
        },
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [wanted]);
  return names;
}

export function ProjectList(): ReactElement {
  const [projects, setProjects] = useState<ProjectListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const names = useTargetNames(projects);

  useEffect(() => {
    let live = true;
    apiGet<ProjectListEntry[]>('/api/projects').then(
      (list) => {
        if (live) setProjects(list);
      },
      (err: unknown) => {
        if (live) setError(messageOf(err));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const create = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const problem = validateOp({ op: 'rename', name });
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateProjectBody = { name: name.trim() };
      const project = await apiPost<Project>('/api/projects', body);
      navigate(`/p/${encodeURIComponent(project.id)}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <main className="page project-list">
      <h1>Projects</h1>
      {error !== null && <p className="banner error" role="alert">{error}</p>}
      {projects === null ? (
        error === null && <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="muted">No projects yet. Start the first one below.</p>
      ) : (
        <ul className="cards">
          {projects.map((p) => {
            const path = `/p/${encodeURIComponent(p.id)}`;
            return (
              <li key={p.id} className="card project-card">
                <a href={path} onClick={(e) => followLink(e, path)} className="project-link">{p.name}</a>
                <span className="project-target">
                  {p.target === null ? (
                    <span className="muted">Nothing picked yet</span>
                  ) : (
                    <>
                      <ItemIcon itemKey={p.target} size={20} />
                      <span>{names[p.target] ?? p.target}</span>
                    </>
                  )}
                </span>
                <span className="muted project-changed">{`Changed ${localTime(p.updatedAt)}`}</span>
              </li>
            );
          })}
        </ul>
      )}
      <form className="card new-project" onSubmit={(e) => void create(e)}>
        <label className="field">
          <span>New project</span>
          <input value={name} maxLength={MAX_NAME_LENGTH} placeholder="e.g. Steel line" onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy || name.trim() === ''}>Create</button>
      </form>
    </main>
  );
}
