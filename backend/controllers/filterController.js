const Service = require('../models/Service');
const Category = require('../models/Category');
const { getSortOptionsForClient } = require('../utils/serviceSort');

/**
 * @desc Hent tilgjengelige filtervalg
 * @route GET /api/filter/options
 * @access Public
 */
exports.getFilterOptions = async (req, res) => {
  try {
    // The four reads are independent: run them together (they ran one after another).
    // 1. Get Job counts per category (only for 'open' services)
    const categoryCountsP = Service.aggregate([
      { $match: { status: 'open' } },
      { $unwind: '$categories' },
      {
        $group: {
          _id: { $trim: { input: '$categories' } },
          count: { $sum: 1 },
        },
      },
    ]);
    // 2. Get Job counts per location (city)
    const locationCountsP = Service.aggregate([
      { $match: { status: 'open', 'location.city': { $ne: null } } },
      {
        $group: {
          _id: { $trim: { input: '$location.city' } },
          count: { $sum: 1 },
        },
      },
    ]);
    // 3. Get Job counts for Urgent (Fiks ferdig)
    const urgentCountP = Service.countDocuments({ status: 'open', urgent: true });
    const [categoryCounts, locationCounts, urgentCount, activeCategories] = await Promise.all([
      categoryCountsP,
      locationCountsP,
      urgentCountP,
      Category.find({ isActive: true }).lean(),
    ]);

    // Create a map with normalized keys (lowercase and trimmed)
    const catCountMap = {};
    categoryCounts.forEach((c) => {
      if (c._id) {
        catCountMap[c._id.toLowerCase()] = c.count;
      }
    });

    const locCountMap = locationCounts.map((l) => ({
      name: l._id,
      count: l.count,
    }));

    // Fetch all top-level categories and their subcategories
    let allCategories = activeCategories;

    let categoryTree = [];
    if (allCategories.length > 0) {
      // Organize categories hierarchically
      categoryTree = allCategories
        .filter((cat) => !cat.parentId)
        .map((parent) => ({
          ...parent,
          count: catCountMap[parent.name.trim().toLowerCase()] || 0,
          subcategories: allCategories
            .filter((sub) => sub.parentId && sub.parentId.toString() === parent._id.toString())
            .map((sub) => ({
              ...sub,
              count: catCountMap[sub.name.trim().toLowerCase()] || 0,
            })),
        }));
    } else {
      // Fallback: Get distinct categories from Services if Category collection is empty
      const distinctCats = await Service.distinct('categories');
      categoryTree = distinctCats.map((name) => {
        const trimmedName = name.trim();
        return {
          _id: trimmedName,
          name: trimmedName,
          count: catCountMap[trimmedName.toLowerCase()] || 0,
          subcategories: [],
        };
      });
    }

    return res.status(200).json({
      success: true,
      filters: {
        categories: categoryTree,
        locations: locCountMap.sort((a, b) => a.name.localeCompare(b.name)),
        urgentCount,
        priceRange: { min: 0, max: 100000 },
        // Served from utils/serviceSort.js so the values advertised here are exactly
        // the values GET /api/services accepts. They were maintained separately and
        // had drifted apart entirely, which is why sorting silently did nothing.
        //
        // `value` is the stable API key and must stay language-independent; `label`
        // is display text. Never send a translated label as the query value.
        sortOptions: getSortOptionsForClient(),
        types: [
          { label: 'Kjøp', value: 'sale', count: 0 },
          { label: 'Gratis', value: 'free', count: 0 },
          { label: 'Ønskes kjøpt', value: 'wanted', count: 0 },
        ],
      },
    });
  } catch (error) {
    console.error('GET FILTER OPTIONS ERROR:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not fetch filter options',
    });
  }
};
