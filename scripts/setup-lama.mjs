import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pythonEnv = path.join(root, '.lama-venv')
const isWindows = process.platform === 'win32'
const pythonInEnv = path.join(pythonEnv, isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal || code}).`))
    })
  })
}

function supportsPython(command, prefix = []) {
  const result = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8' })
  const version = `${result.stdout || ''} ${result.stderr || ''}`.match(/Python (\d+)\.(\d+)/)
  return result.status === 0 && version
    && Number(version[1]) === 3 && Number(version[2]) >= 10 && Number(version[2]) <= 12
}

function findPython() {
  if (process.env.LAMA_SETUP_PYTHON) {
    if (!supportsPython(process.env.LAMA_SETUP_PYTHON)) {
      throw new Error('LAMA_SETUP_PYTHON 3.10–3.12 sürümünü göstermelidir.')
    }
    return { command: process.env.LAMA_SETUP_PYTHON, prefix: [] }
  }
  const candidates = isWindows
    ? [['py', ['-3.11']], ['py', ['-3.12']], ['py', ['-3.10']], ['python', []]]
    : [['python3.11', []], ['python3.12', []], ['python3.10', []], ['python3', []], ['python', []]]
  for (const [command, prefix] of candidates) {
    if (supportsPython(command, prefix)) return { command, prefix }
  }
  throw new Error('LaMa kurulumu için Python 3.10, 3.11 veya 3.12 gerekli. LAMA_SETUP_PYTHON ile Python yolunu belirtebilirsiniz.')
}

try {
  const { command, prefix } = findPython()
  await run(command, [...prefix, '-m', 'venv', pythonEnv])
  await run(pythonInEnv, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  if (process.platform === 'win32' || process.platform === 'linux') {
    await run(pythonInEnv, [
      '-m', 'pip', 'install', 'torch==2.5.1',
      '--index-url', 'https://download.pytorch.org/whl/cpu',
    ])
  } else {
    await run(pythonInEnv, ['-m', 'pip', 'install', 'torch==2.5.1'])
  }
  await run(pythonInEnv, ['-m', 'pip', 'install', '-r', 'requirements-lama.txt'])
  await run(pythonInEnv, ['scripts/lama_model.py', '--download'])
  console.log('LaMa yerel kurulumu tamamlandı. Model ilk çalıştırmada belleğe alınır.')
} catch (error) {
  console.error(`LaMa kurulumu başarısız: ${error.message}`)
  process.exitCode = 1
}
