export default (path: string): boolean => {
  // '/home' renders the public org landing; for a logged-in user we want to be
  // bounced to the dashboard (admin) or LMS (student) instead of seeing it.
  return (
    ['login', 'signup', 'onboarding'].some((r) => path.includes(r)) ||
    path === '/' ||
    path === '/home'
  );
};
