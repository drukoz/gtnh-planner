// The site's front page (RUK-510): what the planner is, for anyone who opens the site. It calls no API: while the planner
// asks for a password, a 401 would send the visitor to the login form (api/client.ts), and this page must stand on its own.
// It says nothing about a password, which the planner asks for only when its owner turns one on (spec §3.11).

import type { ReactElement } from 'react';
import { followLink } from '../router.ts';

/** The landing page at `/`: the planner's name, what it does, and the way in (`/projects`, behind the password when one is on). */
export function LandingPage(): ReactElement {
  return (
    <main className="page landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <h1 id="landing-title">GTNH Line Planner</h1>
        <p className="landing-lead">Plan automation lines for GregTech: New Horizons and fit them into the base you already have.</p>
        <p>Pick what to make and how fast. The planner works out the whole recipe chain, finds room for the line in your world, hooks it into your power and logistics, shows it block by block in 3D and hands you the build list.</p>
        <div className="landing-actions">
          <a className="landing-cta primary" href="/projects" onClick={(e) => followLink(e, '/projects')}>Open the planner</a>
          <a className="landing-cta" href="/world" onClick={(e) => followLink(e, '/world')}>Upload a world</a>
        </div>
      </section>
      <section className="landing-section" aria-labelledby="landing-features">
        <h2 id="landing-features">What it does</h2>
        <ul className="landing-grid">
          <li className="card">
            <h3>The recipe chain</h3>
            <p>Choose what to make and how much per minute. The planner solves the whole chain, picks machines and overclocks, adds up the power, and draws it as a flow diagram you can rearrange and swap recipes in.</p>
          </li>
          <li className="card">
            <h3>Fits your base</h3>
            <p>Upload a world backup and the planner reads your base: machines, power networks, pipes and storage. It finds free room nearby and hooks the line into what is already there.</p>
          </li>
          <li className="card">
            <h3>3D view</h3>
            <p>Turn and zoom the line in your own pack's textures, step through it layer by layer, and see the blocks already in your base as faint ghosts.</p>
          </li>
          <li className="card">
            <h3>Logistics</h3>
            <p>Direct, Project Red, AE2, EnderIO or by hand: the Connections view shows every pipe, cable and channel the line needs, and how to set each one.</p>
          </li>
          <li className="card">
            <h3>Materials and steps</h3>
            <p>A list of everything to craft or gather, minus the machines you already own, and build steps your group ticks off together, each tick with a name.</p>
          </li>
          <li className="card">
            <h3>In-game projector</h3>
            <p>A small mod shows the planned build as ghosts in your world, marks each placed block right or wrong, and ticks the steps off as you build.</p>
          </li>
        </ul>
      </section>
      <section className="landing-section" aria-labelledby="landing-steps">
        <h2 id="landing-steps">How it works</h2>
        <ol className="landing-grid">
          <li className="card">
            <h3>Export your pack</h3>
            <p>On the computer that runs the planner, <code>npm run export</code> reads the recipes from a copy of your GTNH server, and <code>npm run extract-assets</code> copies the textures out of your own mod jars.</p>
          </li>
          <li className="card">
            <h3>Upload your world</h3>
            <p>On the World page, upload a backup of your world. The planner scans it and finds your base.</p>
          </li>
          <li className="card">
            <h3>Plan and build</h3>
            <p>Start a project, pick what to make, and build the line from its build steps or with the projector in game.</p>
          </li>
        </ol>
      </section>
      <section className="landing-section card" aria-labelledby="landing-data">
        <h2 id="landing-data">Your pack, your world</h2>
        <p>Nothing from the game ships with the planner. Recipes, textures and worlds come from your own copy of the pack and stay on the computer that runs the planner.</p>
      </section>
      <footer className="landing-footer">
        <p className="muted">Made for GregTech: New Horizons 2.9 on Minecraft 1.7.10. A fan-made tool, not affiliated with the GTNH team or Mojang.</p>
      </footer>
    </main>
  );
}
