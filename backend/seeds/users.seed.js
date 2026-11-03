// Test users (~20): customer1–8@jobblo.no post jobs, helper1–8@jobblo.no are private helpers,
// painter@ / cleaning@ / moving@ / carpenter@jobblo.no are businesses. Fictional names; photo,
// about me, skills, availability and location, some profiles complete and some partial.
// Passwords are in Bitwarden ("Jobblo Test"); the data holds only their bcrypt hashes.
const { load } = require('./load');

module.exports = () => load(['users']);
