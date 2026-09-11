import assert from 'node:assert/strict'
import test from 'node:test'
import { TOOL_DEFINITIONS, handleMcpMessage } from '../src/mcp.js'

test('MCP negocia o protocolo e anuncia ferramentas Pequi', async () => {
  const initialized = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  })
  assert.equal(initialized.result.serverInfo.name, 'pequi')
  assert.equal(initialized.result.protocolVersion, '2025-06-18')

  const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(listed.result.tools, TOOL_DEFINITIONS)
  assert.ok(listed.result.tools.some((tool) => tool.name === 'pequi_publish_diagram'))
})

test('MCP devolve erro de ferramenta no envelope esperado', async () => {
  const response = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'inexistente', arguments: {} },
  })
  assert.equal(response.result.isError, true)
})
