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
// Evening/weekend rate: only when every chosen day is a Saturday or Sunday (2026-11-07 = Sat).
const { weekendOnly } = await import('./price.ts');
assert.equal(weekendOnly('2026-11-07'), true);
assert.equal(weekendOnly('2026-11-07', '2026-11-08'), true);
assert.equal(weekendOnly('2026-11-07', '2026-11-09'), false);
assert.equal(weekendOnly('2026-11-09'), false);
assert.equal(weekendOnly(''), false);
// "Dine utkast": the web's shape both ways, and garbage never breaks opening a draft.
const { toDraftData, fromDraftData, draftWorthSaving } = await import('./draft.ts');
const { emptyJobValues } = await import('../../services/createJob.service.ts');
const filled = {
  ...emptyJobValues(),
  title: 'Male stua',
  categories: ['Maling'],
  coordinates: [59.91, 10.75],
  price: '3000',
  paymentType: 'Fastpris',
  checklist: [{ id: '1', text: 'Dekke til' }],
  customerType: 'business',
  jobType: 'Male ett rom (vegger)',
};
const draftSaved = toDraftData({
  values: filled,
  summary: 'male stua',
  photos: [
    { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' },
    { uri: 'file:///b.jpg', name: 'b.jpg', type: 'image/jpeg' },
  ],
  photoUrls: { 'file:///a.jpg': 'https://blob.test/a.jpg' },
});
assert.equal(draftSaved.categories, 'Maling'); // the web holds one category as a string
assert.equal(draftSaved.latitude, 59.91);
assert.deepEqual(draftSaved.draftImageUrls, { 'file:///a.jpg': 'https://blob.test/a.jpg' });
assert.equal(
  toDraftData({ values: emptyJobValues(), summary: '', photos: [], photoUrls: {} }).latitude,
  null
);

const back = fromDraftData(JSON.parse(JSON.stringify(draftSaved)));
assert.deepEqual(back.values, filled);
assert.equal(back.summary, 'male stua');
assert.deepEqual(
  back.photos.map((p) => p.uri),
  ['https://blob.test/a.jpg']
);

// A web draft: no customerType (the flow uses the account's), odd values cleaned.
const web = fromDraftData({
  title: 'Vask',
  categories: 'Rengjøring',
  latitude: 60.39,
  longitude: 5.32,
  paymentType: 'weird',
  durationUnit: 'years',
  checklistItems: [{ id: 'x', text: 'Gulv' }, null, { text: '' }, 'junk'],
  draftImageUrls: { sig1: 'https://blob.test/w.jpg', sig2: 'javascript:alert(1)', sig3: 7 },
});
assert.deepEqual(web.values.categories, ['Rengjøring']);
assert.deepEqual(web.values.coordinates, [60.39, 5.32]);
assert.equal(web.values.paymentType, 'Fastpris');
assert.equal(web.values.durationUnit, 'hours');
assert.deepEqual(web.values.checklist, [{ id: 'x', text: 'Gulv' }]);
assert.equal(web.values.customerType, '');
assert.deepEqual(
  web.photos.map((p) => p.uri),
  ['https://blob.test/w.jpg']
);
for (const junk of [{}, { tags: 'x', checklistItems: 'y', draftImageUrls: 5, latitude: 'n' }]) {
  const d = fromDraftData(junk);
  assert.deepEqual(d.values.coordinates, [0, 0]);
  assert.deepEqual(d.photos, []);
}
assert.equal(draftWorthSaving(emptyJobValues(), '  '), false);
assert.equal(draftWorthSaving(emptyJobValues(), 'male stua'), true);

// Opening a draft: on the summary when it has a title, else where the answers stop.
store.getState().reset();
store.getState().openDraft('d1', back);
assert.equal(store.getState().step, 'review');
assert.equal(store.getState().draftId, 'd1');
assert.equal(store.getState().draftPhotoUrls['https://blob.test/a.jpg'], 'https://blob.test/a.jpg');
store.getState().openDraft('d2', fromDraftData({ categories: 'Maling', smartFillPrompt: 'x' }));
assert.equal(store.getState().step, 'text');
store.getState().reset();
assert.equal(store.getState().draftId, null);
// Publishing a draft: stored photos by URL in their place, new ones as new:<n>.
const { draftImageOrder } = await import('../../services/createJob.service.ts');
assert.deepEqual(
  draftImageOrder([
    { uri: 'file:///n1.jpg', name: '', type: '' },
    { uri: 'https://blob.test/a.jpg', name: '', type: '' },
    { uri: 'file:///n2.jpg', name: '', type: '' },
  ]),
  ['new:0', 'https://blob.test/a.jpg', 'new:1']
);
console.log('post-job flow: ok');
