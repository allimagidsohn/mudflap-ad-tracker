import { Hono } from 'hono'
import { pool } from '../db.js'

const PATCHABLE = new Set([
  'concept',
  'status',
  'core_insight',
  'hypothesis',
  'notes',
  'funnel_stage',
  'job',
  'format',
  'tone',
  'production_method',
  'visual_style',
  'scenes',
  'meta_copy',
  'metrics',
  'revision_notes',
  'primary_text',
])

const app = new Hono()

app.get('/', async (c) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ads ORDER BY created_at DESC`,
    )
    return c.json(rows)
  } catch (e) {
    console.error(e)
    return c.json({ error: e.message || 'Database error' }, 500)
  }
})

app.post('/', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const cols = []
  const vals = []
  const placeholders = []
  let i = 1
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k) || k === 'id') continue
    cols.push(k)
    vals.push(v)
    placeholders.push(`$${i++}`)
  }
  if (!cols.length) {
    return c.json({ error: 'No valid fields to insert' }, 400)
  }
  const q = `
    INSERT INTO ads (${cols.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *
  `
  try {
    const { rows } = await pool.query(q, vals)
    return c.json(rows[0], 201)
  } catch (e) {
    console.error(e)
    return c.json({ error: e.message || 'Database error' }, 500)
  }
})

app.patch('/:id', async (c) => {
  const id = c.req.param('id')
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const sets = []
  const vals = []
  let i = 1
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue
    sets.push(`${k} = $${i++}`)
    vals.push(v)
  }
  if (!sets.length) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }
  vals.push(id)
  const q = `
    UPDATE ads SET ${sets.join(', ')}
    WHERE id = $${i}
    RETURNING *
  `
  try {
    const { rows } = await pool.query(q, vals)
    if (!rows.length) {
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(rows[0])
  } catch (e) {
    console.error(e)
    return c.json({ error: e.message || 'Database error' }, 500)
  }
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const { rowCount } = await pool.query('DELETE FROM ads WHERE id = $1', [id])
    if (!rowCount) {
      return c.json({ error: 'Not found' }, 404)
    }
    return new Response(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return c.json({ error: e.message || 'Database error' }, 500)
  }
})

export default app
