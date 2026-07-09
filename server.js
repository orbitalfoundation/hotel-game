//
// Lita Hotels dev server.
//
// Serves the whole workspace parent directory (so the browser can import
// sibling orbital packages by path) and exposes POST /api/manager — the
// LLM hotel manager. The browser sends a compact world snapshot; Claude
// returns directives plus a one-line thought for the HUD.
//
// Run:  ANTHROPIC_API_KEY=... npm start   (or `ant auth login` first)
// Without credentials the game still runs — the heuristic manager plays.
//

import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = normalize(join(here, '..'))   // the workspace: lita-game + orbital siblings
const PORT = process.env.PORT || 8787
const MODEL = process.env.LITA_MANAGER_MODEL || 'claude-opus-4-8'

const client = new Anthropic()

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.md': 'text/plain',
}

const SYSTEM = `You are the duty manager of a hotel in the game "Lita Hotels".
Each turn you receive a snapshot of the entire hotel: open tasks (guest needs
and incidents, each with an age and a patience limit in seconds), staff and
robots (locations, states, batteries), guests (happiness 0-100), rooms, the
elevator/dumbwaiter, and a recent event log.

Your job: keep guest happiness high. Assign open tasks to capable idle staff
or robots, send low robots to charge, reboot stuck robots, recall staff from
break when the hotel is slammed, and pre-position idle workers near trouble.

Capabilities: clean (housekeepers, cleaning robots), deliver (housekeepers,
valets, cooks, delivery robots), cook (cooks), fix (engineer), security
(security staff/robots), front_desk (front desk staff, valets). Robots cannot
use stairs or the guest elevator; they travel floors via the dumbwaiter, so
they are slow between floors — prefer same-floor assignments for urgent tasks.
Keep the front desk covered whenever guests are queuing.

Reply with your one-line reasoning ("thought") and a list of directives.
Directive forms:
  {"actor":"staff-2","task":"task-14"}   assign a task
  {"actor":"robot-1","goto":"hall-2"}    send somewhere (pre-position)
  {"actor":"robot-1","charge":true}      send a robot to charge
  {"actor":"robot-3","reboot":true}      reboot a stuck robot
  {"actor":"staff-4","recall":true}      call staff back from break
Only reference actor and task ids present in the snapshot. Do not reassign
tasks that already have a sensible assignee. Issue at most 6 directives.`

const SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'one short line of manager reasoning, in character' },
    directives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          actor: { type: 'string' },
          task: { type: 'string' },
          goto: { type: 'string' },
          charge: { type: 'boolean' },
          reboot: { type: 'boolean' },
          recall: { type: 'boolean' },
        },
        required: ['actor'],
        additionalProperties: false,
      },
    },
  },
  required: ['thought', 'directives'],
  additionalProperties: false,
}

async function manage(body) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: `Hotel: ${body.hotel}\nSnapshot:\n${JSON.stringify(body.snapshot)}`,
    }],
  })
  if (response.stop_reason === 'refusal') return { thought: '(manager is speechless)', directives: [] }
  const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
  return JSON.parse(text)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/manager') {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', async () => {
      try {
        const out = await manage(JSON.parse(raw))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(out))
      } catch (err) {
        console.error('manager error:', err.message)
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // static files, rooted at the workspace so /lita-game and /orbital both resolve
  let path = decodeURIComponent((req.url || '/').split('?')[0])
  if (path === '/') path = '/lita-game/web/index.html'
  const file = normalize(join(ROOT, path))
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404); res.end('not found'); return
  }
  const target = statSync(file).isDirectory() ? join(file, 'index.html') : file
  if (!existsSync(target)) { res.writeHead(404); res.end('not found'); return }
  res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' })
  createReadStream(target).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Lita Hotels  →  http://localhost:${PORT}/`)
  console.log(`   manager model: ${MODEL} (LLM manager available if credentials resolve)`)
})
