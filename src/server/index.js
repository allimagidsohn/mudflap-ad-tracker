import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import ads from './routes/ads.js'
import generate from './routes/generate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** In prod bundle, `server.js` lives next to `index.html` in `dist/`. In dev, resolve repo `dist/`. */
function resolveDistDir() {
  const nextToThis = join(__dirname, '.')
  if (existsSync(join(nextToThis, 'index.html'))) {
    return nextToThis
  }
  return join(__dirname, '../../dist')
}

const distDir = resolveDistDir()
const app = new Hono()

app.route('/api/ads', ads)
app.route('/api/generate', generate)

const hasBuiltClient = existsSync(join(distDir, 'index.html'))

if (hasBuiltClient) {
  const shell = (file) => () => {
    const html = readFileSync(join(distDir, file), 'utf-8')
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    })
  }

  app.get('/', shell('index.html'))
  app.get('/create', shell('create.html'))
  app.get('/index.html', shell('index.html'))
  app.get('/create.html', shell('create.html'))

  app.use('/*', serveStatic({ root: distDir }))
}

const port = Number(process.env.PORT || 3001)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Listening on http://localhost:${info.port}`)
  },
)
