const { mongoose } = require('../db');

const EvidenceSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileType: {
      type: String,
      enum: ['image', 'document', 'video', 'audio', 'other'],
      default: 'other',
    },
    hash: { type: String, default: '' }, // e.g. SHA-256, for chain-of-custody integrity checks
    uploadedBy: { type: String, default: '' },
    uploadDate: { type: Date, default: Date.now },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

EvidenceSchema.index({ caseId: 1, uploadDate: -1 });

module.exports = mongoose.models.Evidence || mongoose.model('Evidence', EvidenceSchema);
