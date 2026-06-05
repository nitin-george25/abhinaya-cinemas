/* Careers — open roles pulled live from Supabase `job_openings` table.
 *
 * Empty state: an always-welcoming message pointing applicants at hr@.
 * Filled state: stacked role cards with title, location, employment type,
 * a summary blurb and an "Apply" CTA that pre-fills a mailto: link.
 *
 * RLS on `job_openings` is configured so anon can only read rows where
 * `is_published = true and archived_at is null` — owner/manager manage
 * the catalog from the admin console.
 */

const HR_EMAIL = 'hr@abhinayacinemas.com';

function applyMailto(role) {
  const subject = encodeURIComponent(`Application — ${role.title}`);
  const body = encodeURIComponent(
    `Hello Abhinaya Cinemas team,\n\n` +
    `I'd like to apply for the ${role.title} role.\n\n` +
    `A short note on why I think I'd be a good fit:\n\n\n\n` +
    `My resume is attached.\n\n` +
    `Thank you,\n`
  );
  return `mailto:${role.apply_email || HR_EMAIL}?subject=${subject}&body=${body}`;
}

async function loadOpenings() {
  const today = new Date().toISOString();
  try {
    const { data, error } = await window.sbClient
      .from('job_openings')
      .select('id,title,location,employment,summary,description,apply_email,sort_order')
      .eq('is_published', true)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[abhinaya] failed to load job openings', err);
    return [];
  }
}

function RoleCard({ role }) {
  const [hover, setHover] = useState(false);
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', padding: '28px 30px',
        transition: 'all .28s var(--ease)',
        transform: hover ? 'translateY(-3px)' : 'none',
        boxShadow: hover ? 'var(--shadow-lg)' : 'none',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 26, lineHeight: 0.95 }}>
            {role.title}
          </h3>
          <div className="meta" style={{ marginTop: 10, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {role.location   && <span><Icon name="map-pin" size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} />{role.location}</span>}
            {role.employment && <span><Icon name="clock"   size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} />{role.employment}</span>}
          </div>
          {role.summary && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.65, color: 'var(--fg-muted)', margin: '18px 0 0', maxWidth: 640 }}>
              {role.summary}
            </p>
          )}
        </div>
        <a href={applyMailto(role)} style={{ alignSelf: 'flex-start' }}>
          <Button variant="primary" size="sm" icon="arrow-right">Apply</Button>
        </a>
      </div>
      {role.description && (
        <details style={{ marginTop: 18 }}>
          <summary style={{
            cursor: 'pointer', fontFamily: 'var(--font-text)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 12,
            color: 'var(--fg-faint)', listStyle: 'none',
          }}>Read more ↓</summary>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.7, color: 'var(--fg-muted)', marginTop: 14, whiteSpace: 'pre-wrap' }}>
            {role.description}
          </div>
        </details>
      )}
    </article>
  );
}

function CareersEmpty() {
  return (
    <div style={{
      padding: '56px 40px', border: '1px dashed var(--border)',
      borderRadius: 'var(--r-lg)', background: 'var(--bg-surface)',
      maxWidth: 760, margin: '0 auto', textAlign: 'center',
    }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>No open roles right now</div>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, lineHeight: 1.7, color: 'var(--fg)', margin: 0, maxWidth: 580, marginInline: 'auto' }}>
        We are always on the lookout for ambitious cinema lovers. Email{' '}
        <a href={`mailto:${HR_EMAIL}`} className="screen-text" style={{ fontWeight: 700 }}>{HR_EMAIL}</a>{' '}
        with your resume and a short note on why you think you'd be a good fit at
        Abhinaya Cinemas — we'll get back to you.
      </p>
    </div>
  );
}

function CareersSkeleton() {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)', padding: '28px 30px',
    }}>
      <div style={{ height: 24, width: '38%', background: '#222', borderRadius: 6 }} />
      <div style={{ height: 12, width: '24%', background: '#1d1d1a', borderRadius: 6, marginTop: 12 }} />
      <div style={{ height: 10, width: '90%', background: '#1d1d1a', borderRadius: 6, marginTop: 18 }} />
      <div style={{ height: 10, width: '70%', background: '#1d1d1a', borderRadius: 6, marginTop: 8 }} />
    </div>
  );
}

function Careers() {
  const [roles, setRoles] = useState(null);

  useEffect(() => {
    let alive = true;
    loadOpenings().then((r) => { if (alive) setRoles(r); });
    return () => { alive = false; };
  }, []);

  const loading = roles === null;

  return (
    <section id="careers" style={{ maxWidth: 1280, margin: '0 auto', padding: '96px 32px' }}>
      <div style={{ marginBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Join us</div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'clamp(2rem,4vw,3.25rem)', lineHeight: 0.95 }}>
          Careers at Abhinaya
        </h2>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.7, color: 'var(--fg-muted)', marginTop: 18, maxWidth: 620 }}>
          Help shape the next chapter of a 50-year-old cinema. We hire for craft,
          warmth and care for the audience experience.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <CareersSkeleton /><CareersSkeleton />
        </div>
      ) : roles.length === 0 ? (
        <CareersEmpty />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {roles.map((r) => <RoleCard key={r.id} role={r} />)}
        </div>
      )}
    </section>
  );
}

Object.assign(window, { Careers });
