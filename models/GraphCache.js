/**
 * GraphCache — precomputed link-analysis graph layout for a case, so
 * GET /api/cases/:id/graph doesn't have to recompute node/edge positions
 * from potentially millions of CDR records on every request.
 * One document per case (upserted), invalidated whenever CDR data changes.
 */
const { mongoose } = require('../db');

const GraphCacheSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true, index: true },
    graph: { type: mongoose.Schema.Types.Mixed, required: true }, // { nodes: [...], edges: [...] }
    generatedAt: { type: Date, default: Date.now },
    recordCountAtGeneration: { type: Number, default: 0 }, // used to detect staleness
  },
  { timestamps: true }
);

module.exports = mongoose.models.GraphCache || mongoose.model('GraphCache', GraphCacheSchema);
