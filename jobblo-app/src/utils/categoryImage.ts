import type { ImageSourcePropType } from 'react-native';

/**
 * Category photos for the hero showcase (Hjem, welcome) and the empty state. Never shown in a
 * job's place: a job without its own photo gets a text card (JobTextCover), since a stock
 * photo could be taken for the actual job. Same photos and keys as the web.
 */
const PHOTOS = {
  maling: require('../../assets/category-showcase/maling.webp'),
  rengjoring: require('../../assets/category-showcase/rengjoring.webp'),
  hagearbeid: require('../../assets/category-showcase/hagearbeid.webp'),
  flytting: require('../../assets/category-showcase/flytting.webp'),
  rorlegger: require('../../assets/category-showcase/rorlegger.webp'),
  montering: require('../../assets/category-showcase/montering.webp'),
  oppussing: require('../../assets/category-showcase/oppussing.webp'),
  transport: require('../../assets/category-showcase/transport.webp'),
} as const;

const BIL_PLEIE = require('../../assets/category-showcase/bil-pleie.webp');

const BY_CATEGORY: Record<string, ImageSourcePropType> = {
  ...PHOTOS,
  smajobber: PHOTOS.montering,
  // "Bil & Pleie" had no photo, so its jobs fell to the rotation's first frame: a painter.
  'bil & pleie': BIL_PLEIE,
  'bil-pleie': BIL_PLEIE,
  car: BIL_PLEIE,
  painting: PHOTOS.maling,
  cleaning: PHOTOS.rengjoring,
  gardening: PHOTOS.hagearbeid,
  moving: PHOTOS.flytting,
  plumbing: PHOTOS.rorlegger,
  renovation: PHOTOS.oppussing,
  delivery: PHOTOS.transport,
  assembly: PHOTOS.montering,
  handyman: PHOTOS.montering,
};

/** The services the Hjem hero shows, in the web's SERVICE_SHOWCASE order. */
export const SERVICE_SHOWCASE: Array<{ name: string; src: ImageSourcePropType }> = [
  { name: 'Maling', src: PHOTOS.maling },
  { name: 'Rengjøring', src: PHOTOS.rengjoring },
  { name: 'Rørlegger', src: PHOTOS.rorlegger },
  { name: 'Flytting', src: PHOTOS.flytting },
  { name: 'Hagearbeid', src: PHOTOS.hagearbeid },
  { name: 'Montering', src: PHOTOS.montering },
  { name: 'Oppussing', src: PHOTOS.oppussing },
  { name: 'Transport', src: PHOTOS.transport },
];

const normalise = (name: string) =>
  name.toLowerCase().trim().replace(/ø/g, 'o').replace(/æ/g, 'a').replace(/å/g, 'a');

/** The bundled photo for one category name, or undefined when there is none. */
export function categoryPhoto(name: string): ImageSourcePropType | undefined {
  return BY_CATEGORY[normalise(name)];
}

export type CategoryTint = { bg: string; fg: string };

const DEFAULT_TINT: CategoryTint = { bg: '#EFF0EA', fg: '#2E6641' };

/**
 * Light background + icon colour per category, for jobs without their own photo (the text
 * card). Same colours as the web (frontend categories/index.ts `categoryTint`). Keyed by the
 * category photo, so every alias in BY_CATEGORY gets the same colour.
 */
const TINT_BY_PHOTO = new Map<ImageSourcePropType, CategoryTint>([
  [PHOTOS.maling, { bg: '#FBF0DC', fg: '#9A6213' }],
  [PHOTOS.rengjoring, { bg: '#E4F1F8', fg: '#2B6A8A' }],
  [PHOTOS.hagearbeid, { bg: '#E3F1DE', fg: '#3B7632' }],
  [PHOTOS.flytting, { bg: '#E7ECF8', fg: '#3A5896' }],
  [PHOTOS.rorlegger, { bg: '#DDF0EF', fg: '#22706F' }],
  [PHOTOS.montering, { bg: '#F3EEDD', fg: '#76662A' }],
  [PHOTOS.oppussing, { bg: '#F7E8DE', fg: '#94522D' }],
  [PHOTOS.transport, { bg: '#ECE7F6', fg: '#5B488A' }],
  [BIL_PLEIE, { bg: '#E9EDF0', fg: '#475561' }],
]);

export function categoryTint(categories: string[] | undefined): CategoryTint {
  const photo = categories?.map(categoryPhoto).find(Boolean);
  return (photo && TINT_BY_PHOTO.get(photo)) || DEFAULT_TINT;
}

/** The job's own first photo URL, or undefined: cards show a text card instead of a stock photo. */
export const jobPhotoUrl = (job: { images?: string[] }): string | undefined =>
  job.images?.find(Boolean);
