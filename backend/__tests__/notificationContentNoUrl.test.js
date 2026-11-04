// A notification's text is shown as is in Varsler and in the push: no raw URLs in it (one read
// "…klart for å starte: http://localhost:5173/settings/payout"). Where to go belongs in
// orderId/requestId or the push payload, not in the sentence.
const fs = require('fs');
const path = require('path');

const ROOTS = ['controllers', 'services', 'jobs', 'utils'].map((d) =>
  path.join(__dirname, '..', d)
);

function* jsFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

test('no notification content carries a URL', () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of jsFiles(root)) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*content:\s*[`'"]/.test(line) && /https?:\/\/|FRONTEND_URL/.test(line))
            offenders.push(`${path.relative(path.join(__dirname, '..'), file)}:${i + 1}`);
        });
    }
  }
  expect(offenders).toEqual([]);
});
