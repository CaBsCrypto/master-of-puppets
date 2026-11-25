import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv.slice(2)
const child = spawn(process.execPath, [resolve(root, 'node_modules/@dcl/sdk-commands/dist/index.js'), ...command], {
  cwd: root,
  // Disable optional analytics for this process: offline builds must finish.
  env: { ...process.env, DCL_DISABLE_ANALYTICS: 'true' },
  stdio: ['inherit', 'pipe', 'pipe']
})
let compositeError = false
for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', data => {
  const text = data.toString()
  if (/can't be instanced|composites are not included|undefined component/i.test(text)) compositeError = true
  output.write(data)
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = compositeError ? 1 : code ?? 1 })
