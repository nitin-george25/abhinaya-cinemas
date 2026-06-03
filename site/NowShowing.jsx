/* Now Showing / Coming Soon — tabbed poster grid, live from Supabase. */
function SectionHeader({ eyebrow, title, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 36, flexWrap: 'wrap' }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>{eyebrow}</div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'clamp(2rem,4vw,3.25rem)', lineHeight: 0.95 }}>{title}</h2>
      </div>
      {right}
    </div>
  );
}

/* Poster: real <img> if poster_url set, otherwise the striped placeholder. */
function Poster({ url, alt, children }) {
  if (url) {
    return (
      <div style={{ aspectRatio: '2/3', overflow: 'hidden', position: 'relative', background: '#0a0a09' }}>
        <img src={url} alt={alt} loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {children}
      </div>
    );
  }
  return (
    <ImgSlot label="poster · 2:3" radius="0" style={{ borderRadius: 0 }}>
      {children}
    </ImgSlot>
  );
}

function MovieCard({ m, onBook }) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', transition: 'all .28s var(--ease)', transform: hover ? 'translateY(-6px)' : 'none', boxShadow: hover ? 'var(--shadow-lg)' : 'none' }}>
      <Poster url={m.posterUrl} alt={m.title}>
        {m.badge && <div style={{ position: 'absolute', top: 14, left: 14 }}><Badge tone={m.badge.tone}>{m.badge.t}</Badge></div>}
        {m.date && <div style={{ position: 'absolute', top: 14, right: 14, fontFamily: 'var(--font-text)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 12, color: 'var(--fg)', background: 'rgba(21,21,21,0.72)', padding: '5px 10px', borderRadius: 'var(--r-xs)', backdropFilter: 'blur(4px)' }}>{m.date}</div>}
      </Poster>
      <div style={{ padding: 18 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 26, lineHeight: 0.95 }}>{m.title}</h3>
        <div className="meta" style={{ marginTop: 8 }}>
          {[m.lang, m.runtime].filter(Boolean).join(' · ')}
        </div>
        {m.times.length > 0 ? (
          <div style={{ display: 'flex', gap: 7, marginTop: 16, flexWrap: 'wrap' }}>
            {m.times.slice(0, 3).map((t) => <Pill key={t} onClick={() => onBook(m, t)}>{t}</Pill>)}
            {m.times.length > 3 && <Pill dim onClick={() => onBook(m, m.times[3])}>+{m.times.length - 3}</Pill>}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}><Button size="sm" variant="quiet" icon="bell">Notify Me</Button></div>
        )}
      </div>
    </div>
  );
}

/* Skeleton card — shown while Supabase is loading. */
function SkeletonCard() {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ aspectRatio: '2/3', background: 'linear-gradient(110deg,#1a1a17 8%,#222 18%,#1a1a17 33%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s linear infinite' }} />
      <div style={{ padding: 18 }}>
        <div style={{ height: 22, width: '70%', background: '#222', borderRadius: 6 }} />
        <div style={{ height: 12, width: '40%', background: '#1d1d1a', borderRadius: 6, marginTop: 10 }} />
      </div>
    </div>
  );
}

function EmptyState({ tab }) {
  return (
    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '64px 24px', border: '1px dashed var(--border)', borderRadius: 'var(--r-lg)', color: 'var(--fg-muted)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{tab}</div>
      <p style={{ margin: 0, fontFamily: 'var(--font-text)', fontSize: 15 }}>
        Programme being finalised. Check back shortly.
      </p>
    </div>
  );
}

function NowShowing({ tab, setTab, onBook }) {
  const [movies, setMovies] = useState({ 'Now Showing': null, 'Coming Soon': null });

  useEffect(() => {
    let alive = true;
    window.loadMovies().then((m) => { if (alive) setMovies(m); });
    return () => { alive = false; };
  }, []);

  const list = movies[tab];
  const loading = list === null;

  return (
    <section id="programme" style={{ maxWidth: 1280, margin: '0 auto', padding: '96px 32px' }}>
      <SectionHeader eyebrow="What's on" title={tab} right={
        <div style={{ display: 'flex', gap: 10 }}>
          <Pill active={tab === 'Now Showing'} onClick={() => setTab('Now Showing')}>Now Showing</Pill>
          <Pill active={tab === 'Coming Soon'} onClick={() => setTab('Coming Soon')}>Coming Soon</Pill>
        </div>
      } />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 24 }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : list.length === 0
            ? <EmptyState tab={tab} />
            : list.map((m) => <MovieCard key={m.title} m={m} onBook={onBook} />)}
      </div>
    </section>
  );
}

Object.assign(window, { NowShowing, MovieCard, SectionHeader });
