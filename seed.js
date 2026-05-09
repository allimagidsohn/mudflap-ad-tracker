import pg from 'pg';
import { readFileSync } from 'fs';

const rows = JSON.parse(readFileSync('./supabase_export.json', 'utf-8'));

// Use the env var from .env
const connectionString = process.env.NEON_POSTGRES_CONNECTION_STRING;
if (!connectionString) {
  console.error('Missing NEON_POSTGRES_CONNECTION_STRING');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function migrate() {
  await client.connect();
  console.log(`Connected. Migrating ${rows.length} rows...`);

  // Map old statuses to new pipeline stages
  const STATUS_MAP = {
    'Drafts': 'Waiting for Review',
    'Editing': 'Waiting for Review',
    'Review / Allocation': 'Waiting for Review',
    'In Design': 'Waiting for Review',
    'Approved for Design': 'Waiting for Review',
    'In Copy Production': 'Waiting for Review',
    'Needs Copy Review': 'Needs Revision',
    'In Production': 'Ready for Production',
    'Live': 'Ready for Production',
    'Winner': 'Ready for Production',
    'Archive': 'Archived',
    'Retired': 'Archived',
    'Briefs': 'Waiting for Review',
  };

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const status = STATUS_MAP[row.status] || row.status || 'Waiting for Review';

    try {
      await client.query(`
        INSERT INTO ads (
          id, created_at, concept, status, core_insight, hypothesis,
          notes, funnel_stage, job, format, tone, production_method,
          visual_style, scenes, meta_copy, metrics, revision_notes, primary_text
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        row.id,
        row.created_at,
        row.concept || '',
        status,
        row.core_insight || '',
        row.hypothesis || '',
        row.notes || '',
        row.funnel_stage || '',
        row.job || '',
        row.format || '',
        row.tone || '',
        row.production_method || '',
        row.visual_style || '',
        JSON.stringify(row.scenes || []),
        JSON.stringify(row.meta_copy || {}),
        JSON.stringify(row.metrics || {}),
        row.revision_notes || '',
        row.primary_text || '',
      ]);

      inserted++;
    } catch (e) {
      console.error(`Failed on row ${row.id} (${row.concept}): ${e.message}`);
      skipped++;
    }
  }

  console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);

  // Verify
  const result = await client.query('SELECT count(*) FROM ads');
  console.log(`Total rows in Neon ads table: ${result.rows[0].count}`);

  // Show status distribution
  const statuses = await client.query('SELECT status, count(*) FROM ads GROUP BY status ORDER BY count DESC');
  console.log('\nStatus distribution:');
  statuses.rows.forEach(r => console.log(`  ${r.status}: ${r.count}`));

  await client.end();
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
