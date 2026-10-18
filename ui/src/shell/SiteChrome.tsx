import notice from '../../../content/legal/data-sources-and-pilot-notice.json';
import type { ReactNode } from 'react';
import { Icon } from '../dashboard/Icon.js';
import { BRAND_SLOGAN, BRAND_SUBHEADER, SOLUTION_HEADLINES, SOLUTION_DESCRIPTION } from './brand.js';

export function SiteBrand({ className = '', tagline = 'HUMANITARIAN INTELLIGENCE' }: { className?: string; tagline?: string }) {
  return <a className={`site-brand ${className}`} href="/" aria-label="AEGIS home"><img src="/brand/aegis-ngo-logo.webp" alt="AEGIS NGO"/><span>{tagline}</span></a>;
}

export function SiteHeader({ children, onMenu }: { children?: ReactNode; onMenu?: () => void }) {
  return <header className="site-header">
    {onMenu && <button className="ui-icon-button mobile-menu" aria-label="Open navigation" onClick={onMenu}><Icon name="menu"/></button>}
    <SiteBrand/>
    {children}
  </header>;
}

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const status = <span className="footer-status">{compact && <span className="prototype-status-dot" aria-hidden="true"/>}<span>Prototype · verify critical information{compact && ' - Every decision starts with a source.'}</span></span>;
  const links = <nav aria-label="Footer"><a href="/assist">Emergency Assist</a><a href="/domains">Hazard domains</a><a href="/legal/data-sources">Data &amp; Compliance</a><a href="/legal/terms">Terms &amp; Privacy</a></nav>;
  return <footer className={`site-footer ${compact ? 'sidebar-site-footer' : ''}`}>
    {compact ? <section className="solution-statement" aria-label="AEGIS solution statement">
      <p className="solution-headline">{SOLUTION_HEADLINES.map((line) => <span key={line}>{line}</span>)}</p>
      <p className="solution-description">{SOLUTION_DESCRIPTION}</p>
    </section> : <div className="footer-brand-copy"><strong>AEGIS</strong><span className="footer-slogan">{BRAND_SLOGAN}</span><span className="footer-subheader">{BRAND_SUBHEADER}</span></div>}
    <p className="pilot-footer-note">{notice.footerNote}</p>
    {compact ? <section className="sidebar-evidence-box" aria-label="Evidence and prototype information">
      <div className="sidebar-trust"><Icon name="shield" size={22}/><strong>Evidence before action.</strong>{status}</div>
      {links}
    </section> : <>{links}{status}</>}
  </footer>;
}
