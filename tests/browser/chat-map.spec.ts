import { expect, test } from '@playwright/test';

// The chat controls the map (AEG-CHAT-002, AEG-NEARBY-001): "show me the worst flood" opens an info panel next to the zoomed marker; "nearest hospital" lists pins.
// The model answer is stubbed (no provider call); the events and panels are the real ones. The keyless test build has no Google map, so the zoom itself is covered by unit tests.
test('chat: show an incident on the map, then the nearest hospital', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'USER-A-COORD' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  const asked: string[] = [];
  await page.route('**/api/helper', async (route) => {
    const body = route.request().postDataJSON() as { text: string };
    asked.push(body.text);
    const focus = body.text.includes('flood');
    await route.fulfill({ json: { messageId: `MSG-${asked.length}`, route: { routeId: null, source: 'model' }, providerNotice: null, attachedRevisions: [], mode: 'normal', escalatedTo: null,
      blocks: focus
        ? [{ type: 'mapFocus', cardId: 'INC-1', revision: 1, lat: 3.5, lng: 101.5, hazard: 'FLOOD', title: 'Flood in Malaysia (GDACS FL 1)', alertLevel: 'ORANGE', country: 'Malaysia', eventTime: '2026-10-15T01:00:00.000Z', why: 'highest alert level among 2 matching current incidents' }, { type: 'text', text: 'The map has zoomed to the worst current flood in our feeds.' }]
        : [{ type: 'places', category: 'hospital', label: 'Hospitals', centre: { lat: 3.139, lng: 101.687 }, centreName: 'the centre of the map', radiusM: 5000, credit: '© OpenStreetMap contributors (ODbL)', advice: 'Call first. In an emergency call your local emergency number before travelling.',
            places: [{ id: 'node/2', name: 'Hospital Kuala Lumpur', lat: 3.1722, lng: 101.7019, distanceM: 4100, phone: '+60 3 2615 5555', website: null, address: null, osmUrl: 'https://www.openstreetmap.org/node/2' }, { id: 'node/3', name: 'Near Clinic Hospital', lat: 3.14, lng: 101.688, distanceM: 140, phone: null, website: null, address: null, osmUrl: 'https://www.openstreetmap.org/node/3' }] },
          { type: 'text', text: 'The nearest hospital is Near Clinic Hospital, 140 m away.' }] } });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  const ask = async (q: string) => { await page.getByPlaceholder('Ask AEGIS…').fill(q); await page.getByRole('button', { name: 'Send' }).click(); };
  await ask('Show me the worst flood');
  // everything the assistant links to is a mini card in the reply
  const mini = page.getByTestId('chat-mini-card');
  await expect(mini).toHaveCount(1);
  await expect(mini).toContainText('Flood in Malaysia (GDACS FL 1)');
  await expect(mini).toContainText('ORANGE');
  await expect(mini).toContainText('Malaysia');
  const focus = page.getByTestId('incident-focus');
  await expect(focus).toBeVisible();
  await expect(focus).toContainText('Flood in Malaysia (GDACS FL 1)');
  await expect(focus).toContainText('ORANGE');
  await expect(focus).toContainText('Malaysia');
  await expect(focus).toContainText('Chosen by: highest alert level');
  await focus.getByRole('button', { name: 'Close and zoom out' }).click();
  await expect(focus).toHaveCount(0);
  await ask('Where is the nearest hospital?');
  await expect(mini).toHaveCount(1);   // the flood card from before (places are their own cards)
  const places = page.getByTestId('chat-place');
  await expect(places).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Show Near Clinic Hospital on the map' })).toContainText('140 m');
  await expect(places.first()).toContainText('+60 3 2615 5555');
  await expect(places.first().getByRole('link', { name: 'Call Hospital Kuala Lumpur' })).toHaveAttribute('href', 'tel:+60326155555');
  await expect(places.first().getByRole('link', { name: 'Directions to Hospital Kuala Lumpur' })).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&destination=3\.1722,101\.7019/);
  await expect(places.first().getByRole('button', { name: /360 degree view outside Hospital Kuala Lumpur/ })).toBeVisible();
  await expect(places.first().getByRole('button', { name: 'Add Hospital Kuala Lumpur to contacts' })).toBeVisible();
  await expect(places.nth(1).getByRole('link', { name: /Call/ })).toHaveCount(0);   // no phone recorded: no call button
  await page.getByRole('button', { name: 'Show Hospital Kuala Lumpur on the map' }).click();   // opens its pin; the map stays clean (a one-line chip, no big list)
  const chip = page.getByTestId('nearby-panel');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Hospitals');
  await chip.getByRole('button', { name: 'Clear nearby places and zoom out' }).click();
  await expect(chip).toHaveCount(0);
  expect(asked).toEqual(['Show me the worst flood', 'Where is the nearest hospital?']);
});

test('chat: place cards show five, then More adds the rest', async ({ page, request }) => {
  const { token } = await (await request.post('/api/session', { data: { userId: 'USER-A-COORD' } })).json() as { token: string };
  await page.addInitScript((t) => sessionStorage.setItem('aegis.session', t), token);
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `node/${i + 10}`, name: `Clinic ${i + 1}`, lat: 3.1 + i / 100, lng: 101.6, distanceM: 300 * (i + 1), phone: null, website: null, address: null, osmUrl: `https://www.openstreetmap.org/node/${i + 10}` }));
  await page.route('**/api/helper', (route) => route.fulfill({ json: { messageId: 'MSG-1', route: { routeId: null, source: 'model' }, providerNotice: null, attachedRevisions: [], mode: 'normal', escalatedTo: null,
    blocks: [{ type: 'places', category: 'clinic', label: 'Clinics and doctors', centre: { lat: 3.139, lng: 101.687 }, centreName: 'the centre of the map', radiusM: 5000, credit: '© OpenStreetMap contributors (ODbL)', advice: 'Call first.', places: many }] } }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByPlaceholder('Ask AEGIS…').fill('clinic near me'); await page.getByRole('button', { name: 'Send' }).click();
  const places = page.getByTestId('chat-place');
  await expect(places).toHaveCount(5);
  await page.getByRole('button', { name: /^More/ }).click();
  await expect(places).toHaveCount(8);
  await expect(page.getByRole('button', { name: /^More/ })).toHaveCount(0);
});
