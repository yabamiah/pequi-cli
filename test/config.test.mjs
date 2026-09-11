import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadGlobalConfig,
  loadProjectConfig,
  saveGlobalConfig,
  saveProjectConfig,
} from '../src/config.js'

test('configurações globais e do repositório são persistidas separadamente', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pequi-cli-'))
  const env = { PEQUI_CONFIG_DIR: join(root, 'global') }
  await saveGlobalConfig({ serverUrl: 'https://pequi.test', token: 'pqt_test' }, env)
  await saveProjectConfig({ projectId: 'prj_1', diagrams: { 'docs/a.mmd': { id: 'dgm_1', revision: 2 } } }, root)

  assert.deepEqual(await loadGlobalConfig(env), {
    serverUrl: 'https://pequi.test/api/v1',
    token: 'pqt_test',
  })
  assert.equal((await loadProjectConfig(root)).diagrams['docs/a.mmd'].revision, 2)
  const stored = JSON.parse(await readFile(join(root, '.pequi', 'project.json'), 'utf8'))
  assert.equal(stored.token, undefined)
})
