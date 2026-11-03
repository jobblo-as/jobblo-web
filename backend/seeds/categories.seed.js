// The 9 job categories from the brief, by their Norwegian names in the app:
// Cleaning → Rengjøring, Plumbing → Rørlegger, Painting → Maling, Moving → Flytting,
// Gardening → Hagearbeid, Renovation → Oppussing, Transportation → Transport,
// Odd jobs → Småjobber, Car & vehicle care → Bil & Pleie. Each with its Lucide icon and order.
// Jobs store the category NAME (services.categories), so jobs.seed needs these names unchanged.
const { load } = require('./load');

module.exports = () => load(['categories']);
