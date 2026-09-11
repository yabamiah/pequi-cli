import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProjectConfig, saveGlobalConfig } from '../src/config.js'
import { publishDiagram } from '../src/workspace.js'

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('push cria o diagrama e depois usa a revisão registrada para atualizá-lo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pequi-workspace-'))
  const env = {
    PEQUI_CONFIG_DIR: join(root, 'global'),
    PEQUI_SERVER_URL: 'https://pequi.test/api/v1',
  }
  await saveGlobalConfig({ token: 'pqt_test', serverUrl: env.PEQUI_SERVER_URL }, env)
  await mkdir(join(root, 'docs'))
  const sourcePath = join(root, 'docs', 'arquitetura.mmd')
  await writeFile(sourcePath, 'flowchart LR\n  A --> B\n')

  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/projects')) {
      return jsonResponse({ projects: [{ id: 'prj_1', slug: 'produto', name: 'Produto' }] })
    }
    if (url.endsWith('/projects/prj_1/diagrams')) {
      const body = JSON.parse(options.body)
      return jsonResponse({ diagram: {
        id: 'dgm_1', projectId: 'prj_1', revision: 1, format: 'mermaid',
        title: body.title, content: body.content, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), clientKey: body.clientKey, sourcePath: body.sourcePath,
      } }, 201)
    }
    if (url.endsWith('/diagrams/dgm_1')) {
      const body = JSON.parse(options.body)
      assert.equal(body.baseRevision, 1)
      return jsonResponse({ diagram: {
        id: 'dgm_1', projectId: 'prj_1', revision: 2, format: 'mermaid',
        title: body.title, content: body.content, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), sourcePath: body.sourcePath,
      } })
    }
    throw new Error(`URL inesperada: ${url}`)
  }

  try {
    const created = await publishDiagram({
      cwd: root, env, title: 'Arquitetura', content: 'flowchart LR\n  A --> B\n', sourcePath,
    })
    assert.equal(created.created, true)
    assert.deepEqual((await loadProjectConfig(root)).diagrams['docs/arquitetura.mmd'], {
      id: 'dgm_1', revision: 1,
    })

    const updated = await publishDiagram({
      cwd: root, env, title: 'Arquitetura', content: 'flowchart LR\n  A --> B --> C\n', sourcePath,
    })
    assert.equal(updated.created, false)
    assert.equal(updated.diagram.revision, 2)
    assert.ok(requests.some(({ url }) => url.endsWith('/diagrams/dgm_1')))
  } finally {
    globalThis.fetch = originalFetch
  }
})
