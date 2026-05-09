import { Hono } from 'hono'

const app = new Hono()

app.post('/', async (c) => {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return c.json({ error: 'ANTHROPIC_API_KEY not configured' }, 401)
  }
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  return c.json(data, r.status)
})

export default app
