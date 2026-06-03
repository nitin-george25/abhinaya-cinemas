/* Overlays — trailer player + seat-booking flow. */
function Overlay({ children, onClose, max = 920 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(10,10,9,0.8)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', padding: 24, animation: 'kitFade .25s var(--ease)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: max, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)', position: 'relative' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 16, zIndex: 2, width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--border-strong)', background: 'rgba(21,21,21,0.6)', color: 'var(--fg)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}><Icon name="x" size={20} /></button>
        {children}
      </div>
    </div>
  );
}

function TrailerModal({ onClose }) {
  return (
    <Overlay onClose={onClose}>
      <ImgSlot label="trailer video — 16:9" ratio="16/9" radius="0">
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 78, height: 78, borderRadius: '50%', background: 'var(--screen-gradient)', display: 'grid', placeItems: 'center', color: 'var(--spring-wood)' }}><Icon name="play" size={28} /></div>
        </div>
      </ImgSlot>
    </Overlay>
  );
}

function BookingModal({ movie, time, onClose }) {
  const [picked, setPicked] = useState([]);
  const [done, setDone] = useState(false);
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'];
  const cols = 10;
  const taken = useRef(new Set(['A3', 'A4', 'C6', 'C7', 'D5', 'F1', 'F2', 'B8'])).current;
  const toggle = (id) => { if (taken.has(id)) return; setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); };
  const price = 180;

  if (done) {
    return (
      <Overlay onClose={onClose} max={520}>
        <div style={{ padding: '56px 40px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--screen-gradient)', display: 'grid', placeItems: 'center', margin: '0 auto 22px', color: 'var(--spring-wood)' }}><Icon name="check" size={30} /></div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 30, margin: 0 }}>Seats Booked</h3>
          <p style={{ fontFamily: 'var(--font-text)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', marginTop: 12 }}>{movie.title} · {time} · {picked.sort().join(', ')}</p>
          <div style={{ marginTop: 28 }}><Button variant="primary" onClick={onClose}>Done</Button></div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose} max={620}>
      <div style={{ padding: '30px 34px 34px' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{movie.lang} · {time}</div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 30, margin: 0 }}>{movie.title}</h3>

        {/* curved screen */}
        <div style={{ margin: '34px auto 8px', width: '70%', height: 8, borderRadius: '50%', background: 'var(--screen-gradient)', filter: 'blur(0.4px)', boxShadow: '0 6px 30px rgba(255,80,30,0.45)' }} />
        <div className="meta" style={{ textAlign: 'center', marginBottom: 26 }}>Screen this way</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
          {rows.map((r) => (
            <div key={r} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <span className="meta" style={{ width: 14 }}>{r}</span>
              {Array.from({ length: cols }).map((_, c) => {
                const id = r + (c + 1);
                const isTaken = taken.has(id), isPicked = picked.includes(id);
                return <button key={id} onClick={() => toggle(id)} aria-label={id} style={{
                  width: 24, height: 24, borderRadius: '6px 6px 4px 4px', cursor: isTaken ? 'not-allowed' : 'pointer', border: 0, transition: 'all .15s var(--ease)',
                  background: isTaken ? 'var(--ink-800)' : isPicked ? 'var(--accent)' : 'rgba(246,245,236,0.16)',
                  opacity: isTaken ? 0.5 : 1,
                }} />;
              })}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 24 }}>
          {[['rgba(246,245,236,0.16)', 'Available'], ['var(--accent)', 'Selected'], ['var(--ink-800)', 'Taken']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i style={{ width: 14, height: 14, borderRadius: 4, background: c, display: 'inline-block' }} /><span className="meta">{l}</span></span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--border)' }}>
          <div>
            <div className="meta">{picked.length} seat{picked.length !== 1 ? 's' : ''}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, color: 'var(--fg)' }}>₹{picked.length * price}</div>
          </div>
          <Button variant="primary" size="lg" icon="arrow-right" onClick={() => picked.length && setDone(true)} style={{ opacity: picked.length ? 1 : 0.4 }}>Confirm</Button>
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { TrailerModal, BookingModal });
