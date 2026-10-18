/**
 * Sample data mode (AEG-SAMPLE-001, per viewer): the pin cards fill with made-up values in Google's format so a visitor can see how a live card will look. The values are built for this viewer's requests only,
 * are never held, and are never Google data. While it is on, a banner on the map says so and turns it off; live refreshes and live checks are off. The same banner shows for everyone when an
 * administrator has loaded sample readings on the server.
 */
export function SampleToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <button type="button" className={`map-news-button map-sample-toggle${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onToggle}
    title={on ? 'Sample data is on: turn it off to see real readings' : 'Show made-up sample values in the cards, to see how live data will look'}>
    <span className="sample-dot" aria-hidden="true"/>Sample data: {on ? 'On' : 'Off'}
  </button>;
}

export function SampleBanner({ viewerOn, serverOn }: { viewerOn: boolean; serverOn: boolean }) {
  if (!viewerOn && !serverOn) return null;
  return <div className="sample-banner" role="status" data-testid="sample-banner">
    <strong>SIMULATION MODE:</strong>
    <span title="SIMULATION MODE: Mock Telemetry Active">Mock Telemetry Active</span>
  </div>;
}
