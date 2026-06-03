/* App shell — wires nav, tabs and overlays together. */
function App() {
  const [active, setActive] = useState('Now Showing');
  const [tab, setTab] = useState('Now Showing');
  const [trailer, setTrailer] = useState(false);
  const [booking, setBooking] = useState(null); // { movie, time }

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
    else if (item === 'Contact') scrollTo('contact');
  };

  const onBook = (movie, time) => setBooking({ movie, time });

  return (
    <div>
      <Header active={active} onNav={onNav} />
      <Hero onPlay={() => setTrailer(true)} onBook={() => onNav('Now Showing')} />
      <NowShowing tab={tab} setTab={(t) => { setTab(t); setActive(t); }} onBook={onBook} />
      <Legacy />
      <Gallery />
      <div id="contact"><Footer onNav={onNav} /></div>
      {trailer && <TrailerModal onClose={() => setTrailer(false)} />}
      {booking && <BookingModal movie={booking.movie} time={booking.time} onClose={() => setBooking(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if (window.lucide) window.lucide.createIcons();
