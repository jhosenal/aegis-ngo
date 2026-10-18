import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { FixedClock } from '../../src/engine/clock.js';
import { EnvStore } from '../../src/services/envStore.js';
import { loadPinRegistry } from '../../src/sources/pinRegistry.js';
import { registerEnvironmentRoute } from '../../src/api/routes/environment.js';

const apps: ReturnType<typeof Fastify>[] = [];
function app() {
  const server = Fastify();
  apps.push(server);
  registerEnvironmentRoute(server, loadPinRegistry(), new EnvStore(), new FixedClock('2026-10-17T00:00:00.000Z'));
  return server;
}

afterEach(async () => { await Promise.all(apps.splice(0).map((server) => server.close())); });

describe('place media public route projection', () => {
  it('serves the researched Cameron Highlands link, Commons credit, licence and both verified sizes', async () => {
    const response = await app().inject('/public/environment/pin/my-35');
    expect(response.statusCode).toBe(200);
    const media = response.json().pin.media;
    expect(media).toMatchObject({
      status: 'matched',
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Cameron_Highlands',
      articleTitle: 'Cameron Highlands',
      fallback: 'hide-image-keep-link',
      image: {
        thumb250: expect.stringContaining('/250px-'),
        thumb500: expect.stringContaining('/500px-'),
        alt: expect.stringContaining('Cameron Highlands'),
        credit: 'Photo: Will Ellis from Reading, England, CC BY 2.0, via Wikimedia Commons',
        licence: 'CC BY 2.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/2.0',
        commonsUrl: 'https://commons.wikimedia.org/wiki/File:Tea_fields_(Will_Ellis).jpg',
      },
    });
  });

  it('keeps unmatched pins photo-free and retains the neutral fallback', async () => {
    const response = await app().inject('/public/environment/pin/sg-05');
    expect(response.statusCode).toBe(200);
    expect(response.json().pin.media).toMatchObject({ status: 'name_mismatch', wikipediaUrl: null, image: null, fallback: 'hide-image-keep-link' });
  });
});
