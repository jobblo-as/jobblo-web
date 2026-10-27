// Run: node src/features/post-job/flow.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The app imports TS files without an extension (Metro resolves them); let plain Node do the same.
registerHooks({
  resolve(specifier, context, next) {
    // The store imports createJob.service, which imports the axios client: not needed here.
    if (specifier.endsWith('/api/client'))
      return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.(tsx?|m?js|json)$/.test(specifier))
        return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const {
  STEPS,
  MAX_PHOTOS,
  nextStep,
  previousStep,
  progress,
  addPhotos,
  movePhoto,
  cameraHint,
  photosForText,
  editChanges,
} = await import('./flow.ts');

// Order, and the arrange-photos screen is skipped both ways when there are no photos.
assert.equal(nextStep('photos', 2), 'photoGrid');
assert.equal(nextStep('photos', 0), 'category');
assert.equal(previousStep('category', 2), 'photoGrid');
assert.equal(previousStep('category', 0), 'photos');
assert.equal(previousStep('photos', 0), null);
assert.equal(nextStep('review', 3), null);
for (let i = 2; i < STEPS.length - 1; i++) assert.equal(nextStep(STEPS[i], 1), STEPS[i + 1]);
assert.equal(progress('review'), 1);

// Photos: never more than 6, no duplicates, order kept.
const p = (n) => ({ uri: `file:///${n}.jpg` });
const five = addPhotos([], [1, 2, 3, 4, 5].map(p));
assert.equal(addPhotos(five, [p(6), p(7), p(8)]).length, MAX_PHOTOS);
assert.deepEqual(
  addPhotos([p(1)], [p(1), p(2)]).map((x) => x.uri),
  [p(1).uri, p(2).uri]
);

// Move: cover photo, one step, out-of-range is a no-op.
const abc = ['a', 'b', 'c'];
assert.deepEqual(movePhoto(abc, 2, 0), ['c', 'a', 'b']);
assert.deepEqual(movePhoto(abc, 0, 1), ['b', 'a', 'c']);
assert.deepEqual(movePhoto(abc, 5, 0), abc);
// Camera hint changes as photos are taken; never empty.
assert.notEqual(cameraHint(0), cameraHint(1));
for (let n = 0; n <= MAX_PHOTOS; n++) assert.ok(cameraHint(n).length > 10);
assert.match(cameraHint(MAX_PHOTOS), /Ferdig|Done/); // either language (i18n.ts LANG)
// Price: Timepris total = rate × hours (a day = 8 h), the same as buildJobFormData sends.
const { totalPrice, priceProblem } = await import('./price.ts');
const base = {
  paymentType: 'Fastpris',
  price: '',
  hourlyRate: '',
  durationValue: '3',
  durationUnit: 'hours',
};
assert.equal(totalPrice({ ...base, price: '2500' }), 2500);
assert.equal(
  totalPrice({
    ...base,
    paymentType: 'Timepris',
    hourlyRate: '500',
    durationValue: '1',
    durationUnit: 'days',
  }),
  4000
);
assert.match(priceProblem({ ...base, price: '0' }), /(over|above) 0/);
assert.match(priceProblem({ ...base, price: '2000000' }), /1 000 000/);
assert.match(priceProblem({ ...base, price: '500', durationValue: '' }), /tid|take/);
assert.equal(priceProblem({ ...base, paymentType: 'Anbud', price: '8000' }), '');

// Details: category names match with Norwegian letters and any case; the AI prompt has the answers.
const { questionsFor, describeForAi } = await import('./details.ts');
assert.ok(questionsFor('Rengjøring').length > 0);
assert.ok(questionsFor('RØRLEGGER').length > 0);
assert.deepEqual(questionsFor('Ukjent kategori'), []);
const prompt = describeForAi({
  summary: '',
  category: 'Maling',
  answers: { what: 'Vegger' },
  durationLabel: 'En hel dag',
  photoCount: 2,
});
assert.match(prompt, /(Kategori|Category): Maling/);
assert.match(prompt, /Vegger/);
assert.doesNotMatch(prompt, /bildet|bildene/); // the photos go as images, never as "se bildet"
assert.doesNotMatch(prompt, /Kunden skriver|customer writes/);
// The camera AI helper's notes reach the title/description prompt; missing notes are skipped.
const withNotes = describeForAi({
  summary: '',
  category: 'Maling',
  answers: {},
  photoCount: 2,
  photoNotes: ['White living-room ceiling', undefined],
});
assert.match(withNotes, /(Bildene viser|The photos show): White living-room ceiling$/m);
assert.doesNotMatch(withNotes, /undefined/);
// Photos the AI helper asked to retake are not written about; unjudged ones (library) are.
const ph = (u) => ({ uri: u });
const pick = photosForText([ph('a'), ph('b'), ph('c'), ph('d')], {
  a: 'ok',
  b: 'blurry',
  c: 'dark',
  d: undefined,
});
assert.deepEqual(
  pick.use.map((p) => p.uri),
  ['a', 'd']
);
assert.equal(pick.skipped, 2);
assert.deepEqual(
  photosForText([ph('x')], { x: 'unclear' }).use.map((p) => p.uri),
  ['x']
);
// Editing: saved photos (https) are never re-uploaded or sent to the AI; removed ones are deleted.
const saved = ['https://cdn/x/1.jpg', 'https://cdn/x/2.jpg'];
const edit = editChanges([ph(saved[1]), ph('file:///new.jpg')], saved);
assert.deepEqual(
  edit.upload.map((p) => p.uri),
  ['file:///new.jpg']
);
assert.deepEqual(edit.imagesToDelete, [saved[0]]);
assert.deepEqual(editChanges(saved.map(ph), saved), { upload: [], imagesToDelete: [] });
assert.deepEqual(photosForText([ph(saved[0]), ph('file:///a.jpg')], {}), {
  use: [ph('file:///a.jpg')],
  skipped: 0,
});
// "Rediger" while a new listing is half made: the listing is put aside, and comes back when the
// edit is saved or cancelled. Without one, leaving the edit is a clean start.
const { usePostJobStore } = await import('./store.ts');
const store = usePostJobStore;
store.getState().update({ categories: ['Maling'], title: 'Male stua' });
store.getState().addPhotos([{ uri: 'file:///new.jpg', name: 'a.jpg', type: 'image/jpeg' }]);
store.getState().goTo('price');
const job = { ...store.getState().values, title: 'Publisert jobb', categories: ['Rengjøring'] };
store.getState().startEdit('job1', job, ['https://cdn/x/1.jpg']);
assert.equal(store.getState().editId, 'job1');
assert.equal(store.getState().values.title, 'Publisert jobb');
store.getState().reset(); // edit saved or cancelled
assert.equal(store.getState().editId, null);
assert.equal(store.getState().values.title, 'Male stua');
assert.equal(store.getState().step, 'price');
assert.deepEqual(
  store.getState().photos.map((x) => x.uri),
  ['file:///new.jpg']
);
assert.equal(store.getState().stash, null);
store.getState().reset(); // the listing itself discarded
assert.equal(store.getState().values.title, '');
store.getState().startEdit('job2', job, []);
store.getState().reset();
assert.equal(store.getState().values.title, '');
assert.equal(store.getState().editId, null);
console.log('post-job flow: ok');
