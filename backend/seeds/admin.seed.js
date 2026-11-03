// A super admin for the admin and developer dashboards: admin@jobblo.no. Kept apart from the
// ~20 test users from the brief. Its password is in Bitwarden ("Jobblo Test"); the data holds
// only the bcrypt hash. The app requires MFA for superAdmin, so the first login sets up an
// authenticator app.
const { load } = require('./load');

module.exports = () => load([{ file: 'admin', collection: 'users' }]);
