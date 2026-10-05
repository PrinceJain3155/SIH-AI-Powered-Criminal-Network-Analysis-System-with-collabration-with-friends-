const { mongoose } = require('../db');

const AiAnalysisSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    summary: { type: String, default: '' },
    riskScore: { type: Number, min: 0, max: 100, default: 0 },
    findings: { type: [String], default: [] },
    suggestions: { type: [String], default: [] },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AiAnalysisSchema.index({ caseId: 1, generatedAt: -1 });

module.exports = mongoose.models.AiAnalysis || mongoose.model('AiAnalysis', AiAnalysisSchema);
