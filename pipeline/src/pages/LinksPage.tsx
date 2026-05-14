import type { ReactNode } from 'react'
import { Instagram, Facebook, Youtube } from 'lucide-react'
import SEO from '../components/SEO'

/**
 * Public social links page — scanned via QR on billing receipts.
 * No authentication required.
 */
const SOCIAL_LINKS: { label: string; url: string; icon: ReactNode; color: string }[] = [
  {
    label: 'Instagram',
    url: 'https://www.instagram.com/asquaregokarting/',
    icon: <Instagram size={28} />,
    color: '#E1306C',
  },
  {
    label: 'Facebook',
    url: 'https://www.facebook.com/AsquareGokarting',
    icon: <Facebook size={28} />,
    color: '#1877F2',
  },
  {
    label: 'YouTube',
    url: 'https://www.youtube.com/@asquaregokarting3851',
    icon: <Youtube size={28} />,
    color: '#FF0000',
  },
]

export default function LinksPage() {
  return (
    <>
      <SEO
        title="Connect With Us"
        description="Follow A Square Go-Karting on Instagram, Facebook & YouTube. Stay updated on events, offers & adventure sports across Andhra Pradesh."
        path="/links"
      />
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 16px',
          fontFamily: "'Segoe UI', Arial, Helvetica, sans-serif",
        }}
      >
        {/* Logo */}
        <img
          src="/asquare-logo.webp"
          alt="A Square GoKarting"
          style={{ width: 200, height: 'auto', marginBottom: 8 }}
        />
        <p
          style={{
            color: '#eab308',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: 'uppercase',
            marginBottom: 32,
          }}
        >
          Follow Us
        </p>

        {/* Social Links */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            width: '100%',
            maxWidth: 340,
          }}
        >
          {SOCIAL_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 20px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 14,
                color: '#fff',
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: 600,
                transition: 'transform 0.2s, background 0.2s',
              }}
              onMouseOver={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'
                ;(e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'
              }}
              onMouseOut={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
                ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
              }}
              onFocus={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'
                ;(e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'
              }}
              onBlur={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'
                ;(e.currentTarget as HTMLElement).style.transform = 'scale(1)'
              }}
            >
              <span style={{ color: link.color, flexShrink: 0 }}>{link.icon}</span>
              <span>{link.label}</span>
            </a>
          ))}
        </div>

        {/* Footer */}
        <p style={{ color: '#555', fontSize: 11, marginTop: 40, textAlign: 'center' }}>
          A Square GoKarting &bull; Anandapuram, Visakhapatnam
        </p>
      </div>
    </>
  )
}
