const Service = require('../models/Service');
const User = require('../models/User');
const Order = require('../models/Order');
const { memo } = require('../utils/memo');

// Only what the favourites cards read (the populated seller was fetched and never used).
const JOB_CARD = 'title images urgent createdAt';
const USER_CARD = 'name lastName avatarUrl verified role planType';

/**
 * GET /api/explore/favorites
 * Returns trending jobs, popular providers, verified businesses, most viewed, and popular demand
 */
exports.getFeaturedFavourites = async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Top 12 Posts (Last 24 hours engagement or recently created)
    // First, get service IDs with most orders in last 24h
    const recentOrders = await Order.aggregate([
      { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
      { $group: { _id: '$serviceId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 12 },
    ]);

    const orderServiceIds = recentOrders.map((o) => o._id);

    // Fetch services: either they have recent orders, OR they were created in last 24h
    let topJobs = await Service.find({
      $or: [{ _id: { $in: orderServiceIds } }, { createdAt: { $gte: twentyFourHoursAgo } }],
      status: { $in: ['open', 'active'] },
    })
      .sort({ views: -1, createdAt: -1 })
      .limit(12)
      .select(JOB_CARD)
      .lean();

    // Fallback/Fill: If we don't have 12 jobs yet, fill with top viewed jobs overall
    if (topJobs.length < 12) {
      const existingIds = topJobs.map((j) => j._id);
      const moreJobs = await Service.find({
        _id: { $not: { $in: existingIds } },
        status: { $in: ['open', 'active'] },
      })
        .sort({ views: -1, createdAt: -1 })
        .limit(12 - topJobs.length)
        .select(JOB_CARD)
        .lean();

      topJobs = [...topJobs, ...moreJobs];
    }

    // 2. Top 6 Rated Verified Users
    const topRatedUsers = await User.find({
      verified: true,
      accountStatus: { $in: ['active', 'verified'] },
      isDeleted: { $ne: true },
    })
      .sort({ averageRating: -1, reviewCount: -1 })
      .limit(6)
      .select(USER_CARD)
      .lean();

    // If still no verified users, fallback to top rated providers
    let finalUsers = topRatedUsers;
    if (finalUsers.length === 0) {
      finalUsers = await User.find({
        role: 'provider',
        accountStatus: { $in: ['active', 'verified'] },
        isDeleted: { $ne: true },
      })
        .sort({ averageRating: -1, reviewCount: -1 })
        .limit(6)
        .select(USER_CARD)
        .lean();
    }

    // Combine and format for the frontend Favourites component
    const combinedData = [];

    // Map Top Jobs
    topJobs.forEach((job) => {
      combinedData.push({
        id: `job-${job._id}`,
        title: job.title,
        image:
          job.images && job.images.length > 0
            ? job.images[0]
            : 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2',
        badge: job.urgent ? 'Urgent' : job.createdAt >= twentyFourHoursAgo ? 'New' : 'Trending',
        type: 'job',
        originalId: job._id,
      });
    });

    // Map Users
    finalUsers.forEach((user) => {
      combinedData.push({
        id: `user-${user._id}`,
        title: `${user.name} ${user.lastName || ''}`,
        image: user.avatarUrl || 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2',
        badge: user.verified ? 'Verified Pro' : 'Top Rated',
        type: user.role === 'company' || user.planType === 'business' ? 'business' : 'provider',
        originalId: user._id,
      });
    });

    res.json(combinedData);
  } catch (err) {
    console.error('Explore Favourites Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/explore/stats
 * Returns dashboard stats: active jobs count, total users, average rating
 */
exports.getDashboardStats = async (req, res) => {
  try {
    // Shared by every visitor: computed once per 30 s per process (utils/memo). It used to
    // hydrate EVERY user with a review to average one number in JS (~320 ms at 2k raters).
    // In the "services" namespace so a listing write refreshes activeJobs.
    res.json(await memo('services:explore-stats', 30, computeDashboardStats));
  } catch (err) {
    console.error('Explore Stats Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

async function computeDashboardStats() {
  const [activeJobs, totalUsers, [rating]] = await Promise.all([
    Service.countDocuments({ status: { $in: ['open', 'active'] } }),
    User.countDocuments({ isDeleted: { $ne: true } }),
    // Average of averageRating across users who have reviews, rounded to 1 decimal.
    User.aggregate([
      { $match: { reviewCount: { $gt: 0 }, isDeleted: { $ne: true } } },
      { $group: { _id: null, avg: { $avg: '$averageRating' } } },
    ]),
  ]);
  return {
    activeJobs,
    totalUsers,
    averageRating: rating?.avg ? Math.round(rating.avg * 10) / 10 : 0,
  };
}
exports.computeDashboardStats = computeDashboardStats;
