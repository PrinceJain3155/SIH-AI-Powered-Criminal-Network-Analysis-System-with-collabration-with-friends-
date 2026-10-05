const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const Timeline = require('../models/Timeline');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.use(requireAuth);

// GET /api/cases/:id/timeline — the case action audit log (case created,
// CDR imported, evidence added, etc.), auto-populated by other routes.
router.get(
  '/cases/:id/timeline',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    if (!(await assertCaseAccess(req, res, req.params.id))) return;
    const entries = await Timeline.find({ caseId: req.params.id }).sort({ ts: -1 }).limit(limit).lean();
    res.json(entries);
  })
);

module.exports = router;
