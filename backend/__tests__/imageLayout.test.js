/**
 * "Bilder": the owner's photo order. Only photos on the listing are placed, none is lost,
 * and the share-card metadata follows the first photo.
 */
const { imageLayout } = require('../controllers/services/manageController');

const doc = {
  images: ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/new0.jpg'],
  imageMetadata: [
    { url: 'https://x/a.jpg', ogUrl: 'og-a' },
    { url: 'https://x/b.jpg', ogUrl: 'og-b' },
    { url: 'https://x/new0.jpg', ogUrl: 'og-new' },
  ],
};

test('no order from the client: nothing changes (older clients, the app)', () => {
  expect(imageLayout(doc, {}, [])).toBeNull();
  expect(imageLayout(doc, { imageOrder: 'not json' }, [])).toBeNull();
});

test('new files and existing photos are placed in the chosen order', () => {
  const out = imageLayout(
    doc,
    { imageOrder: JSON.stringify(['new:0', 'https://x/b.jpg', 'https://x/a.jpg']) },
    ['https://x/new0.jpg']
  );
  expect(out.images).toEqual(['https://x/new0.jpg', 'https://x/b.jpg', 'https://x/a.jpg']);
  expect(out.imageMetadata[0].ogUrl).toBe('og-new');
});

test('foreign URLs, repeats and bad tokens are ignored; unlisted photos stay, at the end', () => {
  const out = imageLayout(
    doc,
    { imageOrder: ['https://evil/x.jpg', 'https://x/b.jpg', 'https://x/b.jpg', 'new:9', 42] },
    ['https://x/new0.jpg']
  );
  expect(out.images).toEqual(['https://x/b.jpg', 'https://x/a.jpg', 'https://x/new0.jpg']);
});

describe("draftImagesFor: photos uploaded with the poster's own draft", () => {
  const JobDraft = require('../models/JobDraft');
  const { draftImagesFor } = require('../controllers/services/manageController');
  const draftId = '64b000000000000000000009';
  const stored = [
    { url: 'https://x/d1.jpg', blobName: 'job_images/d1.jpg' },
    { url: 'https://x/d2.jpg', blobName: 'job_images/d2.jpg' },
  ];
  afterEach(() => jest.restoreAllMocks());

  test("only the draft's own photos that the form placed, looked up by owner", async () => {
    const findOne = jest.spyOn(JobDraft, 'findOne').mockReturnValue({
      select: () => ({ lean: async () => ({ images: stored }) }),
    });
    const body = { imageOrder: JSON.stringify(['https://x/d2.jpg', 'https://evil/x.jpg']) };
    expect(await draftImagesFor('u1', draftId, body)).toEqual([stored[1]]);
    expect(findOne).toHaveBeenCalledWith({ _id: draftId, user: 'u1' });
  });

  test("someone else's draft, a bad id or no order: nothing", async () => {
    jest.spyOn(JobDraft, 'findOne').mockReturnValue({
      select: () => ({ lean: async () => null }),
    });
    const body = { imageOrder: ['https://x/d1.jpg'] };
    expect(await draftImagesFor('u2', draftId, body)).toEqual([]);
    expect(await draftImagesFor('u1', 'nope', body)).toEqual([]);
    expect(await draftImagesFor('u1', draftId, {})).toEqual([]);
  });
});
