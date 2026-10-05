/**
 * scripts/migrate.js
 *
 * One-time migration: moves every existing Case document's embedded
 *   savedData.records  -> cdr_records collection
 *   savedData.towers   -> tower_records collection
 *   notes (embedded array) -> notes collection
 * then strips `savedData` and `notes` off the Case document, leaving only
 * metadata — matching the new schema in models/Case.js.
 *
 * Safe to re-run: cases already migrated (no `savedData` field left) are
 * skipped. Each case is migrated independently, so a failure partway
 * through does not corrupt other cases; re-running will retry only the
 * ones that failed or haven't been touched yet.
 *
 * Usage:
 *   node scripts/migrate.js
 *   MONGODB_URI=mongodb://prod-host:27017 DB_NAME=cdrIntelligence node scripts/migrate.js
 *   node scripts/migrate.js --dry-run     (report what would change, write nothing)
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'cdrIntelligence';
const BATCH_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');

function log(...args) {
  console.log(`[migrate ${new Date().toISOString()}]`, ...args);
}

async function batchInsert(collection, docs) {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    if (!DRY_RUN) {
      const result = await collection.insertMany(batch, { ordered: false });
      inserted += Object.keys(result.insertedIds).length;
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

async function migrateCase(db, caseDoc) {
  const caseId = caseDoc.id;
  if (!caseId) {
    log(`  SKIP _id=${caseDoc._id} — missing app-level "id" field, cannot link child records safely.`);
    return { skipped: true };
  }

  const savedData = caseDoc.savedData;
  const records = (savedData && Array.isArray(savedData.records)) ? savedData.records : [];
  const towers = (savedData && Array.isArray(savedData.towers)) ? savedData.towers : [];
  const notes = Array.isArray(caseDoc.notes) ? caseDoc.notes : [];

  let recordsInserted = 0;
  let towersInserted = 0;
  let notesInserted = 0;

  if (records.length) {
    recordsInserted = await batchInsert(
      db.collection('cdr_records'),
      records.map((r) => {
        const { _id, ...rest } = r; // never carry over an old embedded _id
        return { ...rest, caseId };
      })
    );
  }

  if (towers.length) {
    towersInserted = await batchInsert(
      db.collection('tower_records'),
      towers.map((t) => {
        const { _id, ...rest } = t;
        return { ...rest, caseId };
      })
    );
  }

  if (notes.length) {
    notesInserted = await batchInsert(
      db.collection('notes'),
      notes.map((n) => ({ caseId, text: n.text, ts: n.ts ? new Date(n.ts) : new Date() }))
    );
  }

  if (!DRY_RUN) {
    await db.collection('cases').updateOne(
      { _id: caseDoc._id },
      {
        $unset: { savedData: '', notes: '' },
        $set: { updatedAt: new Date() },
      }
    );
  }

  return { recordsInserted, towersInserted, notesInserted };
}

async function run() {
  log(`Connecting to ${MONGODB_URI} (db: ${DB_NAME})${DRY_RUN ? ' [DRY RUN — no writes will be made]' : ''}`);
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    // Only pick up cases that still have the old embedded shape — makes
    // this script idempotent / safe to re-run against a partially
    // migrated database.
    const cursor = db.collection('cases').find({
      $or: [{ savedData: { $exists: true, $ne: null } }, { notes: { $exists: true } }],
    });

    const total = await db.collection('cases').countDocuments({
      $or: [{ savedData: { $exists: true, $ne: null } }, { notes: { $exists: true } }],
    });
    log(`${total} case(s) need migration.`);

    let processed = 0;
    let totalRecords = 0;
    let totalTowers = 0;
    let totalNotes = 0;
    let skipped = 0;

    while (await cursor.hasNext()) {
      const caseDoc = await cursor.next();
      const label = `${caseDoc.caseNo || caseDoc._id} (id=${caseDoc.id || 'MISSING'})`;
      try {
        const result = await migrateCase(db, caseDoc);
        if (result.skipped) {
          skipped++;
        } else {
          totalRecords += result.recordsInserted;
          totalTowers += result.towersInserted;
          totalNotes += result.notesInserted;
          log(`  OK ${label} — ${result.recordsInserted} record(s), ${result.towersInserted} tower(s), ${result.notesInserted} note(s)`);
        }
      } catch (err) {
        log(`  FAILED ${label} — ${err.message} (will not stop the run; re-run this script afterward to retry)`);
      }
      processed++;
    }

    log('----------------------------------------');
    log(`Done. Cases processed: ${processed}, skipped: ${skipped}`);
    log(`Total migrated — records: ${totalRecords}, towers: ${totalTowers}, notes: ${totalNotes}`);
    if (DRY_RUN) log('This was a dry run — no data was actually written.');

    // Index creation (safe/no-op if they already exist) — matches
    // models/*.js index definitions, run here too so a fresh migration
    // target is immediately query-ready even before the app server's
    // first boot builds them itself via Mongoose.
    if (!DRY_RUN) {
      log('Ensuring indexes...');
      await Promise.all([
        db.collection('cases').createIndex({ id: 1 }, { unique: true }),
        db.collection('cases').createIndex({ officer: 1, status: 1 }),
        db.collection('cdr_records').createIndex({ caseId: 1 }),
        db.collection('cdr_records').createIndex({ caseId: 1, TARGET_NO: 1 }),
        db.collection('cdr_records').createIndex({ caseId: 1, B_PARTY_NO: 1 }),
        db.collection('cdr_records').createIndex({ caseId: 1, IMEI: 1 }),
        db.collection('cdr_records').createIndex({ caseId: 1, IMSI: 1 }),
        db.collection('cdr_records').createIndex({ caseId: 1, DATE_TIME: 1 }),
        db.collection('tower_records').createIndex({ caseId: 1 }),
        db.collection('tower_records').createIndex({ caseId: 1, CELL_ID: 1 }),
        db.collection('notes').createIndex({ caseId: 1, ts: -1 }),
        db.collection('tasks').createIndex({ caseId: 1, status: 1 }),
        db.collection('timeline').createIndex({ caseId: 1, ts: -1 }),
        db.collection('graph_cache').createIndex({ caseId: 1 }, { unique: true }),
        db.collection('ai_analysis').createIndex({ caseId: 1, generatedAt: -1 }),
      ]);
      log('Indexes ensured.');
    }
  } finally {
    await client.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
