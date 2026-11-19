// Run: node src/utils/uploadPhotos.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'expo-image-manipulator')
      return {
        url: 'data:text/javascript,export const ImageManipulator={};export const SaveFormat={}',
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { uploadWidth, UPLOAD_MAX_SIDE } = await import('./uploadPhotos.ts');

assert.equal(UPLOAD_MAX_SIDE, 2048);
assert.equal(uploadWidth(4032, 3024), 2048); // 12 MP landscape
assert.equal(uploadWidth(3024, 4032), 1536); // portrait: the height becomes 2048
assert.equal(uploadWidth(8064, 6048), 2048); // 48 MP
assert.equal(uploadWidth(1200, 900), null); // small enough, never enlarged
assert.equal(uploadWidth(0, 0), null);

// Saving an edit: photos prepared first, an upload that hangs is cut off, and the button does
// not wait for list refetches.
const hook = readFileSync(new URL('../hooks/useCreateJob.ts', import.meta.url), 'utf8');
assert.equal((hook.match(/prepareUploadPhotos\(images\)/g) || []).length, 2);
assert.match(hook, /onSuccess: \(_result, variables\) => \{\s*void Promise\.all/);
const service = readFileSync(new URL('../services/createJob.service.ts', import.meta.url), 'utf8');
assert.equal((service.match(/withUploadDeadline\(\(signal\)/g) || []).length, 2);
// Arbeidsbevis: photos prepared too; the size check before upload is only for PDFs.
const provider = readFileSync(new URL('../hooks/useProviderOrder.ts', import.meta.url), 'utf8');
assert.match(provider, /prepareUploadPhotos\(input\.files\)/);
const orderPage = readFileSync(
  new URL('../../app/(app)/provider/orders/[orderId].tsx', import.meta.url),
  'utf8'
);
assert.match(orderPage, /!asset\.type\.startsWith\('image\/'\) && asset\.size/);

console.log('uploadPhotos: ok');
