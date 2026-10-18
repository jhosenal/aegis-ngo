import '../design/tokens.css';
import './brand-header.css';
import { BRAND_SLOGAN, BRAND_SUBHEADER } from './brand.js';

export type BrandPage = 'assist' | 'domains';

const pages = [
  { id: 'assist', label: 'Aegis Assist', href: '/assist' },
  { id: 'domains', label: 'Hazard domains', href: '/domains' },
  { id: 'overview', label: 'NGO overview (preview)', href: '/overview' },
] as const;

export function BrandHeader({ current }: { current: BrandPage }) {
  return <header className="aeg-brand-header">
    <div className="aeg-brand-header-inner">
      <a className="aeg-brand-logo" href="/assist" aria-label="Aegis NGO home">
        <img src="/brand/aegis-ngo-logo.webp" alt="Aegis NGO" />
      </a>
      <p className="aeg-brand-tagline"><span>{BRAND_SLOGAN}</span><small>{BRAND_SUBHEADER}</small></p>
      <nav aria-label="Aegis pages">
        {pages.map((page) => {
          const active = page.id === current;
          return <a key={page.id} href={page.href} title={page.label} aria-label={page.label} aria-current={active ? 'page' : undefined} className={active ? 'aeg-brand-link aeg-brand-link-active' : 'aeg-brand-link'}>
            {page.id === 'overview' ? <><span className="aeg-brand-link-full">{page.label}</span><span className="aeg-brand-link-compact">NGO overview</span></> : page.label}
          </a>;
        })}
      </nav>
    </div>
  </header>;
}
