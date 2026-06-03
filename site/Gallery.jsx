/* Gallery — full-bleed still strip with the theatre experience. */
function Gallery() {
  const shots = ['Auditorium · red velvet', 'The big screen', 'Concession bar', 'Vintage projector', 'Lobby', 'Ticket counter'];
  return (
    <section id="gallery" style={{ maxWidth: 1280, margin: '0 auto', padding: '96px 32px' }}>
      <SectionHeader eyebrow="The experience" title="Inside Abhinaya" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gridAutoRows: '180px', gap: 14 }}>
        {shots.map((s, i) => (
          <ImgSlot key={s} label={s} ratio="auto" radius="var(--r-md)"
            style={{ aspectRatio: 'auto', gridColumn: i === 0 ? 'span 2' : 'auto', gridRow: i === 0 ? 'span 2' : 'auto' }} />
        ))}
      </div>
    </section>
  );
}
Object.assign(window, { Gallery });
