// The site's front page (RUK-510): what the planner is, for anyone who opens the site, before any password. It calls no
// API: a 401 would send the visitor to the login form (api/client.ts), and this page must stand on its own.

import type { ReactElement } from 'react';
import { followLink } from '../router.ts';

/** The landing page at `/`: the planner's name, what it does, and the way in (`/projects`, which asks for the password). */
export function LandingPage(): ReactElement {
  return (
    <main className="page landing">
      <section className="landing-hero">
        <h1>GTNH Line Planner</h1>
        <a className="landing-cta primary" href="/projects" onClick={(e) => followLink(e, '/projects')}>Open the planner</a>
      </section>
    </main>
  );
}
