// routes/filterRoutes.js
const express = require('express');
const router = express.Router();
const filterController = require('../controllers/filterController');
const { cacheJson } = require('../utils/cache');

/**
 * @swagger
 * tags:
 *   name: Filter
 *   description: Filtrering og utforskning av tjenester
 */

/**
 * @swagger
 * /api/filter/options:
 *   get:
 *     summary: Hent tilgjengelige filtervalg
 *     description: Returnerer alle tilgjengelige kategorier, prisintervall og sorteringsvalg.
 *     tags: [Filter]
 *     responses:
 *       200:
 *         description: Filtervalg hentet
 *       500:
 *         description: Serverfeil ved henting av filtervalg
 */
// Job counts per category change all the time: a short cache absorbs bursts of page loads.
router.get('/options', cacheJson('filter-options', 30, { ignoreQuery: true }), filterController.getFilterOptions);

// POST /api/filter/apply was removed: no client called it, and it was public, ran user text as a
// regular expression, had no page limit and returned non-public listings (security review H3).


module.exports = router;
