/**
 * Note — investigation log entries, linked by caseId.
 * Previously an embedded array on the Case document (`case.notes`); moved
 * out so a busy case's log can't push the parent Case document to bloat,
 * and so notes can be paginated/queried independently later if needed.
 */
const { mongoose } = require('../db');

const NoteSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },
    text: { type: String, required: true },
    ts: { type: Date, default: Date.now },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

NoteSchema.index({ caseId: 1, ts: -1 });

module.exports = mongoose.models.Note || mongoose.model('Note', NoteSchema);
