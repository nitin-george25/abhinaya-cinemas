/* App shell — wires nav, tabs and overlays together. */

/* Map: section anchor id  ->  nav label that should light up while it's in view.
 * Now-Showing and Coming-Soon share `#programme`; the active label there is
 * driven by `tab` instead of scroll position. */
const SECTION_TO_NAV = {
  legacy:    'Legacy',
  gallery:   'Gallery',
  careers:   'Careers',
  contact:   'Contact',
};

function App() {
  const [active, setActive] = useState('Now Showing');
  const [tab, setTab] = useState('Now Showing');
  const [trailer, setTrailer] = useState(false);
  const [heroMovie, setHeroMovie] = useState(null);

  // Load the programme once for the hero film (NowShowing fetches its own
  // copy for the grid). Small payload, cheap second read.
  useEffect(() => {
    let alive = true;
    window.loadMovies().then((m) => { if (alive) setHeroMovie(window.pickHero(m)); });
    return () => { alive = false; };
  }, []);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  };

  // Scroll-spy — the nav label follows whichever section is most in view.
  // `#programme` keeps the active label in sync with `tab` (Now Showing vs
  // Coming Soon) since both share the same section.
  useEffect(() => {
    const ids = ['programme', ...Object.keys(SECTION_TO_NAV)];
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el) => el !== null);
    if (elements.length === 0) return;

    // Track which sections are currently intersecting and pick the one
    // closest to the top of the viewport — that's the "current" section.
    const visibility = new Map(elements.map((el) => [el.id, 0]));
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) visibility.set(e.target.id, e.intersectionRatio);
      let bestId = null, bestRatio = 0;
      for (const [id, ratio] of visibility) {
        if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
      }
      if (!bestId) return;
      if (bestId === 'programme') setActive(tab);
      else if (SECTION_TO_NAV[bestId]) setActive(SECTION_TO_NAV[bestId]);
    }, {
      // Cut the top 80px to account for the sticky header so the active
      // label flips as a section actually crosses the header, not before.
      rootMargin: '-80px 0px -45% 0px',
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });

    elements.forEach((el) => observer.observe(el));

    // Topmost view (above the programme section) → Now Showing by default.
    const onScroll = () => {
      if (window.scrollY < 100) setActive(tab);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, [tab]);

  const onNav = (item) => {
    setActive(item);
    if (item === 'Now Showing') { setTab('Now Showing'); scrollTo('programme'); }
    else if (item === 'Coming Soon') { setTab('Coming Soon'); scrollTo('programme'); }
    else if (item === 'Legacy' || item === 'About Us') scrollTo('legacy');
    else if (item === 'Gallery') scrollTo('gallery');
    else if (item === 'Careers') scrollTo('careers');
    else if (item === 'Contact') scrollTo('contact');
  };

  return (
    <div>
      <Header active={active} onNav={onNav} />
      <Hero onPlay={() => setTrailer(true)} onBook={openBms} heroMovie={heroMovie} />
      <NowShowing tab={tab} setTab={(t) => { setTab(t); setActive(t); }} onBook={openBms} />
      <Legacy />
      <Gallery />
      <Careers />
      <Contact />
      <Footer onNav={onNav} />
      {trailer && <TrailerModal trailerUrl={heroMovie && heroMovie.trailerUrl} onClose={() => setTrailer(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if (window.lucide) window.lucide.createIcons();
