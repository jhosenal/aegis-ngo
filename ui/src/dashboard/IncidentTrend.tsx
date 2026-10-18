import catalogue from '../../../content/domains/catalogue.json';
import type { CSSProperties } from 'react';
import type { HazardTrend } from '../../../src/services/hazardTrend.js';

const label = 'Incidents per day (USGS and GDACS live feeds)';
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function IncidentTrend({ data, loading, error, onRetry }: {
  data: HazardTrend | null; loading: boolean; error: boolean; onRetry: () => void;
}) {
  if (loading) return <p className="dashboard-footnote" role="status">Loading incident activity…</p>;
  if (error || !data) return <div className="incident-trend-error" role="status"><p>Incident activity unavailable. Counts are unknown.</p><button className="ui-button" onClick={onRetry}>Retry incident activity</button></div>;
  const max = Math.max(1, ...data.series.map(day => day.total));
  return <figure className="incident-trend">
    <figcaption>{label}</figcaption>
    <p className="trend-scope">All ASEAN feed records · UTC event date · {data.days} days</p>
    {data.series.length === 0 ? <p>No daily series supplied.</p> : <>
      <div className="trend-plot" role="img" aria-label={`${label}. ${data.series.map(day => `${day.date}: ${day.total}`).join('; ')}`}>
        <span className="trend-axis-max" aria-hidden="true">{max}</span>
        <div className="trend-bars" style={{ '--trend-days': data.series.length } as CSSProperties}>
          {data.series.map(day => <div className="trend-day" key={day.date} data-date={day.date} data-total={day.total}>
            <span className="trend-value" aria-hidden="true">{day.total}</span>
            <div className="trend-bar-space"><span className="trend-bar" style={{ height: `${day.total / max * 100}%` }} title={`${day.date} (UTC): ${day.total} incidents`}/></div>
            <time dateTime={day.date} aria-hidden="true">{dayLabel(day.date)}</time>
          </div>)}
        </div>
        <span className="trend-axis-zero" aria-hidden="true">0</span>
      </div>
      {data.series.every(day => day.total === 0) && <p>No incidents recorded in this event-date window.</p>}
      <details className="trend-data"><summary>Daily counts and hazard breakdown</summary><table>
        <caption>Incident counts by UTC event date</caption>
        <thead><tr><th scope="col">Date (UTC)</th><th scope="col">Total</th><th scope="col">Hazard counts</th></tr></thead>
        <tbody>{data.series.map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.total}</td><td>{Object.entries(day.byDomain).map(([domain, count]) => `${domainNames[domain] ?? `Domain ${domain}`}: ${count}`).join(', ') || 'None'}</td></tr>)}</tbody>
      </table></details>
    </>}
    <p className="trend-window-note">{data.olderThanWindow} incidents started before this window. Offshore / unspecified: {data.countryUnknown} current incidents.</p>
    <p className="dashboard-footnote">{data.remarks[0]}</p>
    <p className="trend-as-of">As of <time dateTime={data.asOf}>{new Date(data.asOf).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</time></p>
  </figure>;
}

const domainNames: Record<string, string> = Object.fromEntries(catalogue.domains.map(domain => [String(domain.number), domain.name]));
