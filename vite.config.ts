import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const modelRelative = path.join(
  '.gz',
  'fuel',
  'fuel.ignitionrobotics.org',
  'openrobotics',
  'models',
  'panda with ignition position controller model',
  '5',
)

function hasLink0(dir: string) {
  return fs.existsSync(path.join(dir, 'meshes', 'visual', 'link0.dae'))
}

function pandaModelDir() {
  const fromEnv = process.env.PANDA_MODEL_DIR
  if (fromEnv && hasLink0(fromEnv)) return fromEnv
  const local = path.resolve(root, 'panda-model')
  if (hasLink0(local)) return local
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) {
    const cached = path.join(home, modelRelative)
    if (hasLink0(cached)) return cached
  }
  if (process.platform === 'win32') {
    try {
      const script =
        'wslpath -w "$HOME/.gz/fuel/fuel.ignitionrobotics.org/openrobotics/models/panda with ignition position controller model/5"'
      const converted = execFileSync('wsl.exe', ['-e', 'bash', '-lc', script], {
        encoding: 'utf8',
        timeout: 8000,
      }).trim()
      if (converted && hasLink0(converted)) return converted
    } catch {
      return null
    }
  }
  return null
}

function pandaModelPlugin(): Plugin {
  const types: Record<string, string> = {
    '.dae': 'model/vnd.collada+xml',
    '.png': 'image/png',
    '.stl': 'model/stl',
  }
  const attach = (middlewares: { use: (path: string, handler: (req: { url?: string; method?: string }, res: NodeJS.WritableStream & { setHeader: (name: string, value: string) => void; statusCode: number; end: () => void }, next: () => void) => void) => void }) => {
    const dir = pandaModelDir()
    if (!dir) return
    const rootDir = path.resolve(dir)
    middlewares.use('/panda-model', (req, res, next) => {
      const raw = decodeURIComponent((req.url || '/').split('?')[0])
      const file = path.resolve(rootDir, `.${raw}`)
      const relative = path.relative(rootDir, file)
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        next()
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', types[path.extname(file).toLowerCase()] || 'application/octet-stream')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      fs.createReadStream(file).pipe(res)
    })
  }
  return {
    name: 'panda-model',
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

export default defineConfig({
  plugins: [vue(), pandaModelPlugin()],
  server: {
    host: '0.0.0.0',
    port: 47321,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 47321,
    strictPort: true,
  },
})
