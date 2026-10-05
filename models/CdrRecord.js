/**
 * CdrRecord — one document per call/SMS record.
 *
 * Field names mirror the normalized row shape the frontend already produces
 * in normalizeRow() (index.html) via FIELD_ALIASES, so no client-side
 * transformation is needed going from CSV parse -> API payload.
 *
 *   TARGET_NO   = calling number (A-party)
 *   B_PARTY_NO  = called number (B-party)
 *   FIRST_CGI / LAST_CGI = tower cell-global-identity at call start/end
 *
 * `raw` keeps the original parsed CSV row untouched, so nothing is lost
 * even if a field isn't one of the normalized ones above — important for
 * forensic/chain-of-custody purposes.
 */
const { mongoose } = require('../db');

const CdrRecordSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, index: true },

    TARGET_NO: { type: String, default: '', index: true },
    B_PARTY_NO: { type: String, default: '', index: true },
    CALL_TYPE: { type: String, default: '' },
    DATE_TIME: { type: String, default: '', index: true }, // kept as string: source data isn't always ISO-parseable
    DURATION: { type: Number, default: 0 },

    FIRST_CGI: { type: String, default: '' },
    FIRST_LAT: { type: Number },
    FIRST_LONG: { type: Number },
    LAST_CGI: { type: String, default: '' },
    LAST_LAT: { type: Number },
    LAST_LONG: { type: Number },

    IMEI: { type: String, default: '', index: true },
    IMSI: { type: String, default: '', index: true },

    LRN_NO: { type: String, default: '' },
    LRN_TSP: { type: String, default: '' },
    SMSC_NO: { type: String, default: '' },
    CALL_FWD_NO: { type: String, default: '' },
    ROAM_NO: { type: String, default: '' },
    IN_TG: { type: String, default: '' },
    OUT_TG: { type: String, default: '' },

    // Full original CSV row, in case a field wasn't recognized by
    // FIELD_ALIASES — nothing from the source file is ever dropped.
    raw: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

// caseId alone is the most common query (load/paginate a case's records).
// Compound indexes below speed up the specific lookups the app's
// Search/Link-Analysis/Map pages already do against `records` in memory —
// having them server-side means those same lookups stay fast once querying
// moves server-side too.
CdrRecordSchema.index({ caseId: 1, DATE_TIME: 1 });
CdrRecordSchema.index({ caseId: 1, TARGET_NO: 1 });
CdrRecordSchema.index({ caseId: 1, B_PARTY_NO: 1 });
CdrRecordSchema.index({ caseId: 1, IMEI: 1 });
CdrRecordSchema.index({ caseId: 1, IMSI: 1 });
CdrRecordSchema.index({ caseId: 1, FIRST_CGI: 1 });

module.exports = mongoose.models.CdrRecord || mongoose.model('CdrRecord', CdrRecordSchema);
