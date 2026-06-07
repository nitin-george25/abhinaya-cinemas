/* Gallery - full-bleed still strip with the theatre experience.
 * Real photography lives in /site/assets/photos/. The first tile spans 2x2
 * as the anchor; the rest fill a responsive auto-fit grid. */
function Gallery() {
  const shots = [
    { src: 'big-screen.jpg',   label: 'The big screen',          big: true },
    { src: 'dsc05552.jpg',     label: 'Red velvet recliners' },
    { src: 'dsc05554.jpg',     label: 'Cinematic ambience' },
    { src: 'concession-1.jpg', label: 'The popcorn counter' },
    { src: 'concession-2.jpg', label: 'Ice cream & refreshments' },
  ];
  return (
    <section id="gallery" style={{ maxWidth: 1280, margin: '0 auto', padding: '96px 32px' }}>
      <SectionHeader eyebrow="The experience" title="Inside Abhinaya" />
      <div className="gallery-grid">
        {shots.map((s) => (
          <figure key={s.src} className={s.big ? 'gallery-big' : undefined} style={{ margin: 0, position: 'relative', overflow: 'hidden', borderRadius: 'var(--r-md)', background: '#0a0a09' }}>
            <img src={`/site/assets/photos/${s.src}`} alt={s.label} loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform .5s var(--ease)' }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }} />
            <figcaption style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '28px 16px 12px', fontFamily: 'var(--font-text)', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg)', background: 'linear-gradient(to top, rgba(10,10,9,0.82), transparent)' }}>
              {s.label}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
Object.assign(window, { Gallery });
