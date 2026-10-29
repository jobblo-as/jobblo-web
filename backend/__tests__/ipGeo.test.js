/**
 * Country for the developer IP page: private IPs never leave the server, one batch call per
 * page, answers cached, and a failing lookup only means "no country".
 */
const { geoFor } = require('../services/monitoring/ipGeo');

jest.spyOn(console, 'error').mockImplementation(() => {});

test('one batch for the public IPs; local ones are never sent; then served from cache', async () => {
  const post = jest.fn().mockResolvedValue({
    data: [
      {
        status: 'success',
        query: '84.210.1.2',
        country: 'Norway',
        countryCode: 'NO',
        city: 'Oslo',
      },
      { status: 'fail', query: '203.0.113.9' },
    ],
  });
  const out = await geoFor(['84.210.1.2', '203.0.113.9', '192.168.1.5', '127.0.0.1'], { post });
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual(['84.210.1.2', '203.0.113.9']);
  expect(out.get('84.210.1.2')).toEqual({ country: 'Norway', countryCode: 'NO', city: 'Oslo' });
  expect(out.get('203.0.113.9').country).toBeNull();
  expect(out.get('192.168.1.5').country).toBe('Local network');

  const again = await geoFor(['84.210.1.2'], { post });
  expect(post).toHaveBeenCalledTimes(1); // cached
  expect(again.get('84.210.1.2').country).toBe('Norway');
});

test('a lookup that fails or times out does not throw', async () => {
  const post = jest
    .fn()
    .mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
  const out = await geoFor(['198.51.100.7'], { post });
  expect(out.has('198.51.100.7')).toBe(false);
});
