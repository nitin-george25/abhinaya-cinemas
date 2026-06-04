/* Header / navigation bar with mobile drawer. */
const NAV = ['Now Showing', 'Coming Soon', 'Legacy', 'Gallery', 'Careers', 'Contact'];

function Header({ active, onNav }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: scrolled ? 'rgba(21,21,21,0.82)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px)' : 'none',
      borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
      transition: 'all .3s var(--ease)',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ cursor: 'pointer' }} onClick={() => onNav('Now Showing')}><LogoLockup size={30} /></div>

        <nav style={{ display: 'flex', gap: 26, alignItems: 'center' }} className="kit-desktop-nav">
          {NAV.map((item) => (
            <a key={item} onClick={() => onNav(item)} style={{
              fontFamily: 'var(--font-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.13em',
              fontSize: 13, cursor: 'pointer', position: 'relative', paddingBottom: 4,
              color: active === item ? 'var(--accent)' : 'var(--fg)',
              transition: 'color .2s var(--ease)',
            }}>{item}</a>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="kit-desktop-nav"><Button size="sm" variant="primary" icon="ticket" onClick={openBms}>Book</Button></div>
          <button onClick={() => setOpen(true)} aria-label="Menu" style={{ background: 'none', border: 0, color: 'var(--fg)', cursor: 'pointer', display: 'inline-flex' }}>
            <Icon name="menu" size={26} />
          </button>
        </div>
      </div>

      {/* Mobile / full drawer */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'var(--cod-gray)',
        transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .4s var(--ease)',
        display: 'flex', flexDirection: 'column', padding: '24px 32px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <LogoLockup size={30} />
          <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 0, color: 'var(--fg)', cursor: 'pointer', display: 'inline-flex' }}><Icon name="x" size={28} /></button>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 48 }}>
          {NAV.map((item, i) => (
            <a key={item} onClick={() => { onNav(item); setOpen(false); }} style={{
              fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'clamp(36px,9vw,68px)',
              lineHeight: 1.02, cursor: 'pointer', color: active === item ? 'var(--accent)' : 'var(--fg)',
              display: 'flex', alignItems: 'baseline', gap: 14,
            }}>
              <span style={{ fontFamily: 'var(--font-text)', fontWeight: 600, fontSize: 14, color: 'var(--fg-faint)', letterSpacing: '0.1em' }}>0{i + 1}</span>
              {item}
            </a>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <SocialLinks size={22} gap={20} />
        </div>
      </div>
    </header>
  );
}

Object.assign(window, { Header, NAV });
