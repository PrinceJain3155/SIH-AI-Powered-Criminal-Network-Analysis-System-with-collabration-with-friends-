const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const AiAnalysis = require('../models/AiAnalysis');
const Case = require('../models/Case');
const asyncHandler = require('../utils/asyncHandler');
const { logTimeline } = require('../utils/timelineLogger');

const router = express.Router();
router.use(requireAuth);

// GET /api/cases/:id/analysis — most recent AI analysis result for a case.
router.get(
  '/cases/:id/analysis',
  asyncHandler(async (req, res) => {
    if (!(await assertCaseAccess(req, res, req.params.id))) return;
    const analysis = await AiAnalysis.findOne({ caseId: req.params.id }).sort({ generatedAt: -1 }).lean();
    if (!analysis) return res.status(404).json({ error: 'No analysis found for this case yet' });
    res.json(analysis);
  })
);

// POST /api/cases/:id/analysis — store a new AI analysis result.
// (Generation of the summary/riskScore/findings itself happens upstream of
// this API — this endpoint just persists the result.)
router.post(
  '/cases/:id/analysis',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const { summary, riskScore, findings, suggestions } = req.body;

    const caseDoc = await Case.exists({ id });
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });

    const analysis = await AiAnalysis.create({ caseId: id, summary, riskScore, findings, suggestions });
    await logTimeline(id, 'ai_analysis_generated', 'AI analysis generated.', undefined, req.user);

    res.status(201).json(analysis);
  })
);

module.exports = router;
