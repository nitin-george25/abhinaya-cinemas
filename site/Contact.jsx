/* Contact section — form invokes the Supabase Edge Function `contact`
 * which forwards via Resend to hello@abhinayacinemas.com.
 *
 * Function:  supabase/functions/contact/index.ts
 *            POST https://<project>.supabase.co/functions/v1/contact
 * Body:      { name, email, phone?, message }
 * Success:   { ok: true }
 * Failure:   { error: string }
 *
 * RESEND_API_KEY lives in Supabase Edge Function secrets — shared with
 * the daily/weekly digest functions. No Cloudflare or Netlify wiring.
 */

function ContactInput({ label, name, type = 'text', required, multiline, value, onChange }) {
  const baseStyle = {
    width: '100%', background: 'var(--bg-surface)',
    border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
    color: 'var(--fg)', fontFamily: 'var(--font-text)',
    fontSize: 14, padding: '14px 16px', outline: 'none',
    transition: 'border-color .18s var(--ease)',
  };
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <label style={{ display: 'block' }}>
      <div className="eyebrow" style={{ marginBottom: 8, fontSize: 11 }}>
        {label}{required && <span style={{ color: 'var(--accent)' }}> *</span>}
      </div>
      <Tag
        name={name} type={type} required={required} value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={multiline ? 5 : undefined}
        style={{ ...baseStyle, resize: multiline ? 'vertical' : undefined, fontFamily: multiline ? 'var(--font-body)' : 'var(--font-text)' }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
      />
    </label>
  );
}

function Contact() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [status, setStatus] = useState('idle');   // idle | sending | sent | error
  const [errMsg, setErrMsg] = useState('');

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending'); setErrMsg('');
    try {
      // Calls the Supabase Edge Function at /functions/v1/contact. The
      // supabase-js client attaches the anon `apikey` + `Authorization`
      // headers automatically. RESEND_API_KEY lives in Supabase secrets
      // (same pipeline that sends the daily/weekly digests).
      const { data, error } = await window.sbClient.functions.invoke('contact', { body: form });
      if (error) {
        // Edge function returned a non-2xx — try to surface its error message.
        let msg = error.message || 'Send failed';
        try {
          const ctx = await error.context?.json?.();
          if (ctx?.error) msg = ctx.error;
        } catch {}
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      setStatus('sent');
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch (err) {
      setStatus('error');
      setErrMsg(err.message || 'Could not send message.');
    }
  };

  return (
    <section id="contact" style={{ background: 'var(--ink-950)', borderTop: '1px solid var(--border)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '110px 32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 64 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Get in touch</div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', fontSize: 'clamp(2rem,4vw,3.25rem)', lineHeight: 0.95 }}>
            Say <span className="screen-text">Hello</span>
          </h2>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.7, color: 'var(--fg-muted)', marginTop: 22, maxWidth: 460 }}>
            Bookings, private screenings, sponsorships, or just a hello — drop us a note
            and we'll get back to you.
          </p>

          <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <Icon name="map-pin" size={18} style={{ marginTop: 2, color: 'var(--accent)' }} />
              <div style={{ fontFamily: 'var(--font-text)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                Abhinaya Cinemas, M C Road<br />Perunna, Changanacherry<br />Kottayam, Kerala — 686101
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Icon name="mail" size={18} style={{ color: 'var(--accent)' }} />
              <a href="mailto:hello@abhinayacinemas.com" style={{ fontFamily: 'var(--font-text)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 14, color: 'var(--fg)' }}>
                hello@abhinayacinemas.com
              </a>
            </div>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
          <ContactInput label="Name" name="name" required value={form.name} onChange={set('name')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 18 }}>
            <ContactInput label="Email" name="email" type="email" required value={form.email} onChange={set('email')} />
            <ContactInput label="Phone (optional)" name="phone" type="tel" value={form.phone} onChange={set('phone')} />
          </div>
          <ContactInput label="Message" name="message" multiline required value={form.message} onChange={set('message')} />

          {status === 'error' && (
            <div style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--accent)', padding: '10px 14px', border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)' }}>
              {errMsg}. You can also email us directly at <a href="mailto:hello@abhinayacinemas.com" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>hello@abhinayacinemas.com</a>.
            </div>
          )}
          {status === 'sent' && (
            <div style={{ fontFamily: 'var(--font-text)', fontSize: 13, color: 'var(--chartreuse)', padding: '10px 14px', border: '1px solid var(--chartreuse)', borderRadius: 'var(--r-sm)' }}>
              Thank you — your message is on its way. We'll be in touch shortly.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <Button variant="primary" size="md" icon={status === 'sending' ? 'loader' : 'arrow-right'} onClick={submit}>
              {status === 'sending' ? 'Sending…' : 'Send Message'}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

Object.assign(window, { Contact });
