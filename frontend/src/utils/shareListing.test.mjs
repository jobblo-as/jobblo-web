import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSharePayload } from './shareListing.ts';

test('buildSharePayload: title for the share sheet, the share-card URL as text', () => {
  const payload = buildSharePayload('abc123', 'Maler jobb');

  assert.equal(payload.title, 'Maler jobb');
  // Shared links go through the share-card route (Open Graph preview), with a cache-busting v=.
  assert.match(payload.url, /^https:\/\/jobblo\.no\/share\/job\/abc123\?v=[a-z0-9]+$/);
  // The text is only the URL: the receiving app builds the card (title, image) from OG tags.
  assert.equal(payload.text, payload.url);
});
