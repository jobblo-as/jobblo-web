// The 9 job categories from the brief, by their Norwegian names in the app:
// Cleaning → Rengjøring, Plumbing → Rørlegger, Painting → Maling, Moving → Flytting,
// Gardening → Hagearbeid, Renovation → Oppussing, Transportation → Transport,
// Odd jobs → Småjobber, Car & vehicle care → Bil & Pleie. Each with its Lucide icon and order.
// Jobs store the category NAME (services.categories), so jobs.seed needs these names unchanged.
const { load } = require('./load');

// Matched by name: a database that already has these categories (other ids) is updated in
// place, so its jobs keep pointing at them; only missing ones are added. Nothing is deleted.
module.exports = () => load([{ file: 'categories', collection: 'categories', key: 'name' }]);
