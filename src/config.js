import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787/api/v1'

export function normalizeServerUrl(value = DEFAULT_SERVER_URL) {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`
}

export function globalConfigPath(env = process.env) {
  const root = env.PEQUI_CONFIG_DIR
    ? resolve(env.PEQUI_CONFIG_DIR)
    : resolve(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'pequi')
  return join(root, 'config.json')
}

export function projectConfigPath(cwd = process.cwd()) {
  return join(resolve(cwd), '.pequi', 'project.json')
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error(`Não foi possível ler ${path}: ${error.message}`)
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export async function loadGlobalConfig(env = process.env) {
  const stored = await readJson(globalConfigPath(env), {})
  return {
    serverUrl: normalizeServerUrl(env.PEQUI_SERVER_URL || stored.serverUrl || DEFAULT_SERVER_URL),
    token: env.PEQUI_TOKEN || stored.token || null,
  }
}

export async function saveGlobalConfig(config, env = process.env) {
  const path = globalConfigPath(env)
  const existing = await readJson(path, {})
  await writeJson(path, {
    ...existing,
    ...config,
    serverUrl: normalizeServerUrl(config.serverUrl || existing.serverUrl || DEFAULT_SERVER_URL),
  })
}

export async function clearSession(env = process.env) {
  const path = globalConfigPath(env)
  const existing = await readJson(path, {})
  await writeJson(path, { ...existing, token: null })
}

export async function loadProjectConfig(cwd = process.cwd()) {
  return readJson(projectConfigPath(cwd), { version: 1, diagrams: {} })
}

export async function saveProjectConfig(config, cwd = process.cwd()) {
  await writeJson(projectConfigPath(cwd), {
    version: 1,
    diagrams: {},
    ...config,
  })
}

export function relativeProjectPath(path, cwd = process.cwd()) {
  const absolute = resolve(cwd, path)
  const base = `${resolve(cwd)}/`
  if (!absolute.startsWith(base)) {
    throw new Error('O arquivo precisa estar dentro do repositório atual.')
  }
  return absolute.slice(base.length)
}
