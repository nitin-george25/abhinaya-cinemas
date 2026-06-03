/* Abhinaya Cinemas — UI Kit primitives. Exported to window for cross-file use. */

const { useState, useEffect, useRef } = React;

/* ---------- Logo (official PNGs) ---------- */
const LOGO_BASE = '/site/assets/';
/* ---------- BookMyShow link ---------- */
/* The BMS cinema-specific URL; date suffix is YYYYMMDD for "today". */
const BMS_BASE = 'https://in.bookmyshow.com/cinemas/CNSY/abhinaya-cinemas-4k-dolby-712-changanassery/buytickets/ABCN/';
function bmsUrl(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return BMS_BASE + `${y}${m}${d}`;
}
function openBms() {
  window.open(bmsUrl(), '_blank', 'noopener,noreferrer');
}

function LogoMark({ size = 34, tone = 'cream', style }) {
  const src = LOGO_BASE + (tone === 'dark' ? 'logo-symbol-dark.png' : 'logo-symbol-cream.png');
  return <img src={src} alt="Abhinaya Cinemas" style={{ height: size * 1.18, width: 'auto', display: 'block', ...style }} />;
}

function LogoLockup({ size = 34, tone = 'cream', style }) {
  const src = LOGO_BASE + (tone === 'dark' ? 'logo-lockup-dark.png' : 'logo-lockup-cream.png');
  // lockup art is ~846x203 ≈ 4.17:1; height drives size
  return <img src={src} alt="Abhinaya Cinemas" style={{ height: size * 1.5, width: 'auto', display: 'block', ...style }} />;
}

/* ---------- Icon (Lucide) ---------- */
function Icon({ name, size = 20, stroke = 2, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = '';
      const el = document.createElement('i');
      el.setAttribute('data-lucide', name);
      ref.current.appendChild(el);
      window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': stroke } });
    }
  }, [name, size, stroke]);
  return <span ref={ref} style={{ display: 'inline-flex', width: size, height: size, ...style }} />;
}

/* ---------- Button ---------- */
function Button({ children, variant = 'primary', size = 'md', icon, onClick, style }) {
  const [hover, setHover] = useState(false);
  const sizes = {
    sm: { padding: '10px 18px', fontSize: 12 },
    md: { padding: '14px 26px', fontSize: 14 },
    lg: { padding: '17px 34px', fontSize: 16 },
  };
  const base = {
    fontFamily: 'var(--font-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em',
    border: 0, cursor: 'pointer', borderRadius: 'var(--r-pill)', display: 'inline-flex', alignItems: 'center',
    gap: 10, transition: 'all .2s var(--ease)', whiteSpace: 'nowrap', ...sizes[size],
  };
  const variants = {
    primary: { background: 'var(--screen-gradient)', color: 'var(--spring-wood)', boxShadow: hover ? 'var(--glow-accent)' : 'none', transform: hover ? 'translateY(-1px)' : 'none' },
    solid: { background: hover ? 'var(--accent-press)' : 'var(--accent)', color: 'var(--spring-wood)' },
    ghost: { background: 'transparent', color: 'var(--fg)', border: '1.5px solid', borderColor: hover ? 'var(--fg)' : 'var(--border-strong)' },
    quiet: { background: 'var(--bg-surface)', color: 'var(--fg)', border: '1px solid var(--border)' },
  };
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...base, ...variants[variant], ...style }}>
      {children}{icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
    </button>
  );
}

/* ---------- Badge & Pill ---------- */
function Badge({ children, tone = 'accent' }) {
  const tones = {
    accent: { background: 'var(--accent)', color: 'var(--spring-wood)' },
    yellow: { background: 'var(--selective-yellow)', color: '#151515' },
    blue: { background: 'var(--lochmara)', color: '#fff' },
    quiet: { background: 'var(--bg-elevated)', color: 'var(--fg-muted)', border: '1px solid var(--border)' },
  };
  return <span style={{ fontFamily: 'var(--font-text)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 11, padding: '5px 10px', borderRadius: 'var(--r-xs)', ...tones[tone] }}>{children}</span>;
}

function Pill({ children, active, dim, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: 'var(--font-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 13, whiteSpace: 'nowrap',
        padding: '9px 16px', borderRadius: 'var(--r-sm)', cursor: 'pointer', transition: 'all .18s var(--ease)',
        background: active ? 'var(--accent)' : 'transparent',
        borderWidth: 1, borderStyle: 'solid',
        borderColor: active ? 'var(--accent)' : (hover ? 'var(--fg)' : (dim ? 'var(--border)' : 'var(--border-strong)')),
        color: active ? 'var(--spring-wood)' : (dim ? 'var(--fg-faint)' : 'var(--fg)'),
      }}>{children}</button>
  );
}

/* ---------- Image placeholder (cinematic striped slot) ---------- */
function ImgSlot({ label, ratio = '2/3', radius = 'var(--r-md)', children, style }) {
  return (
    <div style={{
      aspectRatio: ratio, borderRadius: radius, overflow: 'hidden', position: 'relative',
      background: 'repeating-linear-gradient(45deg,#201f1d,#201f1d 10px,#191917 10px,#191917 20px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', ...style,
    }}>
      {children}
      {label && <span style={{ position: 'absolute', bottom: 10, fontFamily: 'ui-monospace,monospace', fontSize: 11, color: 'var(--fg-faint)', letterSpacing: '0.04em' }}>{label}</span>}
    </div>
  );
}

/* ---------- Projector lens rings ---------- */
function LensRings({ size = 520, style }) {
  return (
    <div style={{ width: size, height: size, position: 'relative', ...style }}>
      {[0, 0.16, 0.32, 0.46, 0.58].map((inset, i) => (
        <span key={i} style={{ position: 'absolute', inset: `${inset * size}px`, border: '1px solid', borderColor: i > 2 ? 'var(--border-strong)' : 'var(--border)', borderRadius: '50%' }} />
      ))}
    </div>
  );
}

/* ---------- Diagonal RGB beam ---------- */
function Beam({ width = 90, skew = -18, style }) {
  return (
    <div style={{ display: 'flex', width, transform: `skewX(${skew}deg)`, ...style }}>
      <i style={{ flex: 1, background: 'var(--red-orange)' }} />
      <i style={{ flex: 1, background: 'var(--selective-yellow)' }} />
      <i style={{ flex: 1, background: 'var(--lochmara)' }} />
    </div>
  );
}

Object.assign(window, { LogoMark, LogoLockup, Icon, Button, Badge, Pill, ImgSlot, LensRings, Beam, useState, useEffect, useRef, bmsUrl, openBms });
