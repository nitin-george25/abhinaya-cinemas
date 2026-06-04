// ============================================================================
// /admin/dcr-legacy/* routing middleware.
//
// Same pattern as /admin/dcr/_middleware.ts but pointed at the vanilla
// legacy console's index.html. Will be removed once the legacy console is
// retired (queued task: delete /admin/dcr-legacy/ after Phase C6.4 ships).
// ============================================================================

export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);

  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return next();
  }

  const shellUrl = new URL('/admin/dcr-legacy/index.html', url.origin);
  return next(new Request(shellUrl, request));
};
