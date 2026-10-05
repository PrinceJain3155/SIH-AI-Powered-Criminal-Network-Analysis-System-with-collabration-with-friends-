/**
 * TowerRecord — one document per tower/cell-site entry.
 * Field names mirror what the frontend's tower CSV importer already
 * produces (see the caseTowerFileInput handler in index.html).
 */
const { mongoose } = require('../db');

const TowerRecordSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },

    CELL_ID: { type: String, required: true, index: true },
    LATITUDE: { type: Number },
    LONGITUDE: { type: Number },
    TOWER_NAME: { type: String, default: '' },
    LAC: { type: String, default: '' },
    TAC: { type: String, default: '' },
    ENODEB: { type: String, default: '' },
    OPERATOR: { type: String, default: '', index: true },
    TECHNOLOGY: { type: String, default: '' },
    ADDRESS: { type: String, default: '' },
  },
  { timestamps: true }
);

TowerRecordSchema.index({ caseId: 1, CELL_ID: 1 });

module.exports = mongoose.models.TowerRecord || mongoose.model('TowerRecord', TowerRecordSchema);
