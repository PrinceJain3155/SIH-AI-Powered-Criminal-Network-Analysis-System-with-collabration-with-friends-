const express = require('express');
const { requireAuth, assertCaseAccess } = require('../middleware/auth');
const CdrRecord = require('../models/CdrRecord');
const GraphCache = require('../models/GraphCache');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.use(requireAuth);

/** Build a simple number-to-number link graph via aggregation: each
 *  distinct (TARGET_NO, B_PARTY_NO) pair becomes an edge, weighted by call
 *  count. This runs server-side against the indexed collection instead of
 *  pulling every record to the client to build it in-browser. */
async function computeGraph(caseId) {
  const edges = await CdrRecord.aggregate([
    { $match: { caseId, TARGET_NO: { $ne: '' }, B_PARTY_NO: { $ne: '' } } },
    {
      $group: {
        _id: { a: '$TARGET_NO', b: '$B_PARTY_NO' },
        weight: { $sum: 1 },
        totalDuration: { $sum: '$DURATION' },
      },
    },
    { $sort: { weight: -1 } },
    { $limit: 5000 }, // cap for renderability; the underlying data is still fully queryable via /cdr
  ]);

  const nodeSet = new Set();
  edges.forEach((e) => {
    nodeSet.add(e._id.a);
    nodeSet.add(e._id.b);
  });

  return {
    nodes: [...nodeSet].map((id) => ({ id })),
    edges: edges.map((e) => ({ source: e._id.a, target: e._id.b, weight: e.weight, totalDuration: e.totalDuration })),
  };
}

// GET /api/cases/:id/graph — returns the cached graph if it's still fresh
// (record count unchanged since it was generated), otherwise recomputes
// and re-caches it.
router.get(
  '/cases/:id/graph',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!(await assertCaseAccess(req, res, id))) return;
    const forceRefresh = req.query.refresh === 'true';

    const currentCount = await CdrRecord.countDocuments({ caseId: id });
    const cached = await GraphCache.findOne({ caseId: id }).lean();

    if (!forceRefresh && cached && cached.recordCountAtGeneration === currentCount) {
      return res.json({ ...cached.graph, cached: true, generatedAt: cached.generatedAt });
    }

    const graph = await computeGraph(id);
    const updated = await GraphCache.findOneAndUpdate(
      { caseId: id },
      { $set: { graph, generatedAt: new Date(), recordCountAtGeneration: currentCount } },
      { upsert: true, new: true }
    );

    res.json({ ...graph, cached: false, generatedAt: updated.generatedAt });
  })
);

module.exports = router;
