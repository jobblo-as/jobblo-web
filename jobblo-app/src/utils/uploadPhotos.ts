import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Longest side sent to the server: sharp on a listing page and on a 1200 px share card. */
export const UPLOAD_MAX_SIDE = 2048;

/** Width that keeps the longest side at UPLOAD_MAX_SIDE, or null when it already fits. */
export function uploadWidth(width: number, height: number): number | null {
  const longest = Math.max(width, height);
  if (!width || !height || longest <= UPLOAD_MAX_SIDE) return null;
  return Math.round((width * UPLOAD_MAX_SIDE) / longest);
}

type UploadFile = { uri: string; name: string; type: string };

/**
 * A library photo is the phone's full-size original (12–48 MP, several MB, sometimes HEIC):
 * over mobile data an edit with a few of them could sit on "Lagrer…" for minutes. Every new
 * photo goes up as a JPEG of at most 2048 px. Used for job photos and Arbeidsbevis. Stored
 * photos (https) and non-images (PDF) go as they are, as does a photo that cannot be converted.
 *
 * One photo at a time: a decoded 48 MP photo is ~190 MB of memory, six at once could get
 * the app killed. Each photo is decoded once and resized from that copy.
 */
export async function prepareUploadPhotos<T extends UploadFile>(images: T[]): Promise<T[]> {
  const ready: T[] = [];
  for (const [index, image] of images.entries()) {
    const stored = /^https?:\/\//i.test(image.uri);
    const notImage = Boolean(image.type) && !image.type.startsWith('image/');
    if (stored || notImage) {
      ready.push(image);
      continue;
    }
    try {
      const original = await ImageManipulator.manipulate(image.uri).renderAsync();
      const width = uploadWidth(original.width, original.height);
      const rendered = width
        ? await ImageManipulator.manipulate(original).resize({ width }).renderAsync()
        : original;
      const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
      ready.push({
        ...image,
        uri: saved.uri,
        name: `photo-${Date.now()}-${index}.jpg`,
        type: 'image/jpeg',
      });
    } catch {
      ready.push(image);
    }
  }
  return ready;
}
