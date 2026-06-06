/* Hero — "Where Legacy Meets the Silver Screen".
 *
 * Backdrop is a fixed brand photo (the auditorium); the trailer that plays
 * on "Watch Trailer" belongs to the hero film (see data.jsx -> pickHero).
 * The trailer affordances only render when a hero film with a trailer
 * exists, so the page never offers a play button that does nothing. */
function Hero({ onPlay, onBook, heroMovie }) {
  const hasTrailer = !!(heroMovie && heroMovie.trailerUrl);
  return (
    <section style={{ position: 'relative', minHeight: 'min(92vh, 760px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', textAlign: 'center', padding: '120px 24px 80px' }}>
      {/* film-still backdrop - real auditorium photo, full bleed */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <img src="/site/assets/photos/big-screen.jpg" alt="" aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 50% 30%, rgba(21,21,21,0.42), rgba(21,21,21,0.94) 78%)' }} />
      </div>

      {/* projector lens rings */}
      <LensRings size={620} style={{ position: 'absolute', top: '46%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.5, pointerEvents: 'none' }} />

      <div style={{ position: 'relative', maxWidth: 1000 }}>
        <h1 className="display" style={{ fontSize: 'clamp(3rem, 9vw, 7rem)', margin: 0 }}>
          History of Storytelling,<br /><span className="screen-text">Reimagined.</span>
        </h1>
        <p className="lead" style={{ maxWidth: 680, margin: '26px auto 0' }}>
          For over 50 years, more than just a theatre - a cultural landmark where stories
          come alive, memories are made, and communities gather.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 38, flexWrap: 'wrap' }}>
          <Button variant="primary" size="lg" icon="ticket" onClick={openBms}>Book Tickets</Button>
          {hasTrailer && <Button variant="ghost" size="lg" icon="play" onClick={onPlay}>Watch Trailer</Button>}
        </div>
        {hasTrailer && (
          <div className="eyebrow" style={{ marginTop: 22, color: 'var(--fg-muted)' }}>
            Now in cinemas &middot; {heroMovie.title}
          </div>
        )}
      </div>

      {/* play affordance - only when there's a trailer to play */}
      {hasTrailer && (
        <button onClick={onPlay} aria-label="Play trailer" style={{
          position: 'relative', marginTop: 40, width: 74, height: 74, borderRadius: '50%',
          border: '1.5px solid var(--border-strong)', background: 'rgba(246,245,236,0.06)', color: 'var(--fg)',
          cursor: 'pointer', display: 'grid', placeItems: 'center', backdropFilter: 'blur(4px)', transition: 'all .25s var(--ease)',
        }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--screen-gradient)'; e.currentTarget.style.borderColor = 'transparent'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(246,245,236,0.06)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}>
          <Icon name="play" size={26} />
        </button>
      )}
    </section>
  );
}

Object.assign(window, { Hero });
