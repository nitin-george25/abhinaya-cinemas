/* Live programme data — pulled from Supabase `movies` table.
 *
 * Anon (publishable) key is PUBLIC by Supabase classification; RLS on the
 * database is what actually controls access. Same key the admin/dcr app
 * uses for unauthenticated reads.
 *
 * Classification is driven by `movies.status` (migration cash_15_movie_status):
 *   - 'now_showing'  → Now Showing tab
 *   - 'coming_soon'  → Coming Soon tab
 *   - 'past'         → not shown on the landing page
 *
 * The owner controls `status` from the admin console — no date math, no
 * "today" inference. This is also the only schema the anon-readable RLS
 * policy lets us see.
 *
 * Showtimes: the cinema runs a standard 4-show daily slate. We hard-code it
 * here until a shows/showtimes table is added. Coming-Soon movies get no
 * times and a release-date badge instead.
 */

// Environment detection — mirrors app/src/lib/env.ts exactly so the landing
// page hits the same Supabase project the admin app does:
//   abhinayacinemas.com / www. → prod
//   anything else (*.pages.dev, localhost, branch previews) → staging
//
// Anon keys are PUBLIC by Supabase classification — RLS is what controls
// access. Hardcoding them keeps the deploy zero-config.
const PROD_HOSTS = ['abhinayacinemas.com', 'www.abhinayacinemas.com'];

const SUPABASE_ENVS = {
  prod: {
    url:     'https://xkmjygegtpmmwwnyoufn.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbWp5Z2VndHBtbXd3bnlvdWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODI2NTEsImV4cCI6MjA5NTQ1ODY1MX0.ILYBoN4OqFGIatTCTJ3hhfbGj6n8Q6e5LAhOVDDuTgo',
  },
  staging: {
    url:     'https://lctkvmpzijaspaytunkm.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjdGt2bXB6aWphc3BheXR1bmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTU0NDgsImV4cCI6MjA5NTYzMTQ0OH0.YeYegXQvX0l0FMABDgljs_bV_t9C66x77Y3kj2YZ55A',
  },
};

const ENV_NAME = PROD_HOSTS.includes(location.hostname) ? 'prod' : 'staging';
const SUPABASE_URL  = SUPABASE_ENVS[ENV_NAME].url;
const SUPABASE_ANON = SUPABASE_ENVS[ENV_NAME].anonKey;

const STANDARD_SHOWTIMES = ['10:15 AM', '01:30 PM', '06:15 PM', '09:30 PM'];

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sbClient = sbClient;

// Surface which project we're talking to in the console — invaluable when
// debugging "why isn't this movie showing up" on preview URLs.
console.info('[abhinaya] supabase env:', ENV_NAME, SUPABASE_URL);

/* Format YYYY-MM-DD into "MMM DD" (e.g. "Sep 12"). */
function formatReleaseDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

/* Map a Supabase row to the shape NowShowing.jsx expects. */
function rowToCard(row) {
  const isComingSoon = row.status === 'coming_soon';

  // Light badging — only when something is clearly worth flagging.
  let badge = null;
  if (isComingSoon) {
    badge = { t: 'Soon', tone: 'quiet' };
  } else if (row.certification && row.certification.toUpperCase() === 'A') {
    badge = { t: 'A', tone: 'accent' };
  } else if (row.certification) {
    badge = { t: row.certification.toUpperCase(), tone: 'yellow' };
  }

  return {
    title:    row.name,
    tagline:  row.distributor || '',
    lang:     row.language || 'Malayalam',
    runtime:  '',                                  // not tracked yet
    cert:     row.certification || '',
    badge,
    posterUrl: row.poster_url || null,
    date:     isComingSoon ? formatReleaseDate(row.release_date) : null,
    times:    isComingSoon ? [] : STANDARD_SHOWTIMES,
  };
}

/* Fetch + classify. Returns { 'Now Showing': [...], 'Coming Soon': [...] }. */
async function loadMovies() {
  // The anon RLS policy (migration cash_15) already restricts to
  // status in ('coming_soon','now_showing') and archived_at is null, but
  // we include the filter explicitly for clarity and to avoid surprises if
  // the policy is ever loosened.
  const { data, error } = await sbClient
    .from('movies')
    .select('id,name,distributor,release_date,language,certification,poster_url,status')
    .in('status', ['coming_soon', 'now_showing'])
    .order('release_date', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[abhinaya] failed to load movies', error);
    return { 'Now Showing': [], 'Coming Soon': [] };
  }

  const nowShowing = [];
  const comingSoon = [];
  for (const row of data || []) {
    if (row.status === 'coming_soon') comingSoon.push(rowToCard(row));
    else nowShowing.push(rowToCard(row));
  }

  // Now-showing: most recent release at top (matches "what just opened" feel).
  nowShowing.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // Coming-soon: earliest first (the next thing to release).
  comingSoon.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return { 'Now Showing': nowShowing, 'Coming Soon': comingSoon };
}

window.MOVIES = { 'Now Showing': [], 'Coming Soon': [] };
window.loadMovies = loadMovies;
