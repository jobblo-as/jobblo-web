const NorwayCounty = require('../models/NorwayCounty');
const NorwayMunicipality = require('../models/NorwayMunicipality');
const NorwayArea = require('../models/NorwayArea');
const Service = require('../models/Service');
const { PUBLIC_SERVICE_STATUSES } = require('../constants/serviceVisibility');
const { memo } = require('../utils/memo');

/**
 * GET /api/location-filter/tree
 * Returns the complete location tree with counties, municipalities, and areas
 */
/**
 * Pure: county → municipality → area tree, each level in the input order. One pass to group
 * by parent code (the old version re-filtered every list for every parent: O(n·m)).
 */
function buildLocationTree(counties, municipalities, areas) {
  const group = (rows, key) => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) || []), r]), new Map());
  const areasBy = group(areas, 'municipalityCode');
  const municipalitiesBy = group(municipalities, 'countyCode');
  return counties.map((county) => ({
    type: 'county',
    code: county.code,
    name: county.name,
    children: (municipalitiesBy.get(county.code) || []).map((m) => ({
      type: 'municipality',
      code: m.code,
      name: m.name,
      children: (areasBy.get(m.code) || []).map((a) => ({ type: 'area', code: a.code, name: a.name })),
    })),
  }));
}
exports.buildLocationTree = buildLocationTree;

exports.getLocationTree = async (req, res) => {
  try {
    const fields = 'code name countyCode municipalityCode';
    const [counties, municipalities, areas] = await Promise.all([
      NorwayCounty.find().sort({ name: 1 }).select(fields).lean(),
      NorwayMunicipality.find().sort({ name: 1 }).select(fields).lean(),
      NorwayArea.find().sort({ name: 1 }).select(fields).lean(),
    ]);
    res.json(buildLocationTree(counties, municipalities, areas));
  } catch (err) {
    console.error('Location Tree Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/location-filter/stats
 * Returns job count per location
 */
/** Pure: fold { _id: { c, m, a }, count } groups into the per-level count maps. */
function foldLocationStats(groups) {
  const stats = { counties: {}, municipalities: {}, areas: {} };
  const add = (map, code, n) => {
    if (code != null) map[code] = (map[code] || 0) + n;
  };
  for (const { _id, count } of groups) {
    add(stats.counties, _id.c, count);
    add(stats.municipalities, _id.m, count);
    add(stats.areas, _id.a, count);
  }
  return stats;
}
exports.foldLocationStats = foldLocationStats;

exports.getLocationStats = async (req, res) => {
  try {
    // One pass over the public listings instead of three, computed once per 30 s per process
    // (utils/memo; "services" namespace, so a listing write refreshes it). Uncached, every
    // filter-panel open ran all three aggregations.
    const stats = await memo('services:location-stats', 30, async () =>
      foldLocationStats(
        await Service.aggregate([
          { $match: { status: { $in: PUBLIC_SERVICE_STATUSES } } },
          { $group: { _id: { c: '$countyCode', m: '$municipalityCode', a: '$areaCode' }, count: { $sum: 1 } } },
        ])
      )
    );
    res.json(stats);
  } catch (err) {
    console.error('Location Stats Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
