// The roadmap API moved to /api/upcomingFeatures in the route-table refactor (75be28e3) while the
// web app (features/roadMap/api/roadmapApi.ts) calls /api/upcoming: every roadmap call was a 404.
const fs = require('fs');
const path = require('path');
const { ROUTES } = require('../routes/api');

test('the roadmap router is mounted where the web app calls it', () => {
  const client = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/features/roadMap/api/roadmapApi.ts'),
    'utf8'
  );
  const called = [...client.matchAll(/['`](\/api\/[a-zA-Z]+)/g)].map((m) => m[1]);
  expect(new Set(called)).toEqual(new Set(['/api/upcoming']));
  expect(ROUTES).toContainEqual(['/api/upcoming', './upcomingFeature']);
});
