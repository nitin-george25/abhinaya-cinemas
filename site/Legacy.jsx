/* Legacy — heritage band with the brand's projector-beam motif. */
function Legacy() {
  const stats = [
    { n: '1974', l: 'Established in Kottayam' },
    { n: '50+', l: 'Years of stories' },
    { n: '3', l: 'Curated auditoriums' },
  ];
  return (
    <section id="legacy" style={{ position: 'relative', background: 'var(--ink-950)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* beam motif: slim spine flush to the left edge */}
      <Beam width={16} skew={0} style={{ position: 'absolute', left: 0, top: 0, height: '100%' }} />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '110px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 56, alignItems: 'center' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>Our legacy</div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'clamp(2.2rem,4.4vw,3.6rem)', lineHeight: 0.94 }}>
            Where Heritage Meets the Future of Cinema
          </h2>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.7, color: 'var(--fg-muted)', marginTop: 22, maxWidth: 520 }}>
            Born in Kottayam, Kerala, Abhinaya has been a family-owned landmark for over five
            decades. Today it steps into a new era — reimagined as a boutique cinema where the
            nostalgia of classic film meets premium comfort, design and service.
          </p>
          <div style={{ marginTop: 30 }}><Button variant="ghost" icon="arrow-right">Read Our Story</Button></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', background: 'var(--bg-surface)' }}>
          {stats.map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'baseline', gap: 22, padding: '28px 32px', borderBottom: i < stats.length - 1 ? '1px solid var(--border)' : 0 }}>
              <span className="screen-text" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(2.6rem,5vw,4rem)', lineHeight: 1 }}>{s.n}</span>
              <span style={{ fontFamily: 'var(--font-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 14, color: 'var(--fg-muted)' }}>{s.l}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
Object.assign(window, { Legacy });
