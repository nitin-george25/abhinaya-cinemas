/* Live programme data — pulled from Supabase `movies` table.
 *
 * Anon (publishable) key is PUBLIC by Supabase classification; RLS on the
 * database is what actually controls access. Same key the admin/dcr app
 * uses for unauthenticated reads.
 *
 * Buckets:
 *   - Now Showing  = active movies whose release_date is in the past (or null)
 *   - Coming Soon  = active movies whose release_date is in the future
 *
 * Showtimes: the cinema runs a standard 4-show daily slate. We hard-code it
 * here until a shows/showtimes table is added. Coming-Soon movies get no
 * times and a release-date badge instead.
 */

const SUPABASE_URL  = 'https://xkmjygegtpmmwwnyoufn.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbWp5Z2VndHBtbXd3bnlvdWZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4ODI2NTEsImV4cCI6MjA5NTQ1ODY1MX0.ILYBoN4OqFGIatTCTJ3hhfbGj6n8Q6e5LAhOVDDuTgo';

const STANDARD_SHOWTIMES = ['10:15 AM', '01:30 PM', '06:15 PM', '09:30 PM'];

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* Format YYYY-MM-DD into "MMM DD" (e.g. "Sep 12"). */
function formatReleaseDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

/* Map a Supabase row to the shape NowShowing.jsx expects. */
function rowToCard(row, isComingSoon) {
  const releasedToday =
    !row.release_date ||
    new Date(row.release_date + 'T00:00:00') <= new Date();

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
    times:    isComingSoon || !releasedToday ? [] : STANDARD_SHOWTIMES,
  };
}

/* Fetch + classify. Returns { 'Now Showing': [...], 'Coming Soon': [...] }. */
async function loadMovies() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('movies')
    .select('id,name,distributor,release_date,language,certification,poster_url,archived_at')
    .is('archived_at', null)
    .order('release_date', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[abhinaya] failed to load movies', error);
    return { 'Now Showing': [], 'Coming Soon': [] };
  }

  const nowShowing = [];
  const comingSoon = [];
  for (const row of data || []) {
    if (row.release_date && row.release_date > today) {
      comingSoon.push(rowToCard(row, true));
    } else {
      nowShowing.push(rowToCard(row, false));
    }
  }
  // Coming-soon: earliest first.
  comingSoon.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { 'Now Showing': nowShowing, 'Coming Soon': comingSoon };
}

window.MOVIES = { 'Now Showing': [], 'Coming Soon': [] };
window.loadMovies = loadMovies;
