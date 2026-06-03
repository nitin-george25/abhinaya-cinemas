/* Footer — wordmark, nav, newsletter, social. */
function Footer({ onNav }) {
  return (
    <footer style={{ background: 'var(--cod-gray)', paddingTop: 80 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 48, paddingBottom: 56, borderBottom: '1px solid var(--border)' }}>
          <div>
            <LogoLockup size={32} />
            <p style={{ fontFamily: 'var(--font-text)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 14, color: 'var(--fg-muted)', marginTop: 20, lineHeight: 1.5, maxWidth: 260 }}>
              50 years of stories, now redefined.
            </p>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Explore</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {NAV.map((i) => <a key={i} onClick={() => onNav(i)} style={{ fontFamily: 'var(--font-text)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 14, color: 'var(--fg-muted)', cursor: 'pointer' }}>{i}</a>)}
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Visit</div>
            <div style={{ fontFamily: 'var(--font-text)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.8 }}>
              MC Road, Kottayam<br />Kerala 686001<br />+91 481 000 0000
            </div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>The reel, in your inbox</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="Email address" style={{ flex: 1, minWidth: 0, background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', color: 'var(--fg)', fontFamily: 'var(--font-text)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 13, padding: '12px 14px', outline: 'none' }} />
              <Button size="sm" variant="solid" icon="arrow-right" />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 22, color: 'var(--fg-muted)' }}>
              <Icon name="instagram" size={20} /><Icon name="facebook" size={20} /><Icon name="youtube" size={20} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingTop: 24 }}>
          <span className="meta">© 2026 Abhinaya Cinemas · abhinayacinemas.com</span>
          <span className="meta">Privacy · Terms</span>
        </div>
      </div>
    </footer>
  );
}
Object.assign(window, { Footer });
