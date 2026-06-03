/* App shell — wires nav, tabs and overlays together. */
function App() {
  const [active, setActive] = useState('Now Showing');
  const [tab, setTab] = useState('Now Showing');
  const [trailer, setTrailer] = useState(false);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  };

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
      <Hero onPlay={() => setTrailer(true)} onBook={openBms} />
      <NowShowing tab={tab} setTab={(t) => { setTab(t); setActive(t); }} onBook={openBms} />
      <Legacy />
      <Gallery />
      <Careers />
      <Contact />
      <Footer onNav={onNav} />
      {trailer && <TrailerModal onClose={() => setTrailer(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if (window.lucide) window.lucide.createIcons();
