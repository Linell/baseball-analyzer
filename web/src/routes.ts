// Hash routing. One table drives the Route type, the parser and the nav links.

export const ROUTES = [
  { path: '/overview', label: 'Overview' },
  { path: '/analysis', label: 'Analysis' },
  { path: '/showcase', label: 'Showcase' },
] as const;

export type Route = (typeof ROUTES)[number]['path'];

// Unknown and empty hashes fall back to the overview, the landing page.
export function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  return ROUTES.find((r) => r.path === hash)?.path ?? '/overview';
}
