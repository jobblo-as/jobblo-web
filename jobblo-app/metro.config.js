const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Metro reads its transform cache for thousands of modules at once (Promise.all over the whole
// graph). On Windows that exceeded the per-process open-file limit: EMFILE "too many open files"
// and a dead dev server. Cap concurrent cache reads/writes; the cache itself is unchanged.
// ponytail: a simple queue; 64 in flight is far below the limit and still keeps Metro busy.
const MAX_OPEN = 64;
let active = 0;
const waiting = [];
const limited =
  (fn) =>
  async (...args) => {
    if (active >= MAX_OPEN) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await fn(...args);
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
config.cacheStores = (config.cacheStores || []).map((store) => {
  const get = store.get.bind(store);
  const set = store.set.bind(store);
  store.get = limited(get);
  store.set = limited(set);
  return store;
});

// rem = 16 px like the website (NativeWind defaults to 14, which made all app text 12.5 %
// smaller than the web: text-[0.75rem] rendered at 10.5 px).
module.exports = withNativeWind(config, { input: './app/global.css', inlineRem: 16 });
