// The page for the current route: the login form on its own, every other page under the header nav, and the name
// prompt over them until this browser has a name.

import type { ReactElement } from 'react';
import { NamePrompt } from './components/NamePrompt.tsx';
import { TopNav } from './components/TopNav.tsx';
import { followLink, useRoute, type Route } from './router.ts';
import { LoginPage } from './views/LoginPage.tsx';
import { ProjectPage } from './views/ProjectPage.tsx';
import { TOP_PAGES } from './views/top-pages.ts';

function NotFound(): ReactElement {
  return (
    <main className="page">
      <h1>Nothing here</h1>
      <p>
        This address is not a page of the planner. <a href="/" onClick={(e) => followLink(e, '/')}>Back to the projects</a>
      </p>
    </main>
  );
}

function RoutePage(props: { route: Exclude<Route, { name: 'login' }> }): ReactElement {
  const { route } = props;
  switch (route.name) {
    case 'top': {
      const Page = TOP_PAGES.find((p) => p.path === route.path)?.component;
      return Page === undefined ? <NotFound /> : <Page />;
    }
    case 'project':
      return <ProjectPage key={route.id} id={route.id} />;
    case 'notFound':
      return <NotFound />;
  }
}

export function App(): ReactElement {
  const route = useRoute();
  if (route.name === 'login') return <LoginPage />;
  return (
    <>
      <TopNav current={route.name === 'top' ? route.path : ''} />
      <RoutePage route={route} />
      <NamePrompt />
    </>
  );
}
