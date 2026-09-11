import { createInterface } from 'node:readline'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { authenticatedApi, publishDiagram, resolveProject } from './workspace.js'
import { loadProjectConfig } from './config.js'

const TOOL_DEFINITIONS = [
  {
    name: 'pequi_status',
    description: 'Verifica a conta autenticada e o projeto Pequi vinculado ao repositório atual.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pequi_list_diagrams',
    description: 'Lista os diagramas Mermaid sincronizados no projeto Pequi atual.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID ou slug opcional do projeto.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pequi_get_diagram',
    description: 'Obtém o Mermaid e a revisão atual de um diagrama no Pequi.',
    inputSchema: {
      type: 'object',
      properties: { diagram_id: { type: 'string' } },
      required: ['diagram_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'pequi_publish_diagram',
    description: 'Cria ou atualiza no Pequi um diagrama Mermaid produzido a partir do código local. Em atualizações, respeita a revisão para evitar sobrescrever trabalho remoto.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título legível do diagrama.' },
        content: { type: 'string', description: 'Código Mermaid completo.' },
        source_path: { type: 'string', description: 'Arquivo Mermaid dentro do repositório. Pode substituir content.' },
        client_key: { type: 'string', description: 'Chave estável opcional para sincronização.' },
        project_id: { type: 'string', description: 'ID ou slug opcional do projeto.' },
        diagram_id: { type: 'string', description: 'ID para atualizar um diagrama existente.' },
        base_revision: { type: 'integer', minimum: 1, description: 'Revisão lida antes da atualização.' },
      },
      required: ['title'],
      anyOf: [{ required: ['content'] }, { required: ['source_path'] }],
      additionalProperties: false,
    },
  },
]

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

async function callTool(name, args, context) {
  if (name === 'pequi_status') {
    const { api, config } = await authenticatedApi(context.env)
    const session = await api.getSession()
    const projectConfig = await loadProjectConfig(context.cwd)
    return result({
      authenticated: true,
      serverUrl: config.serverUrl,
      user: session.user,
      linkedProject: projectConfig.projectId
        ? { id: projectConfig.projectId, name: projectConfig.projectName || null }
        : null,
    })
  }

  if (name === 'pequi_list_diagrams') {
    const { api } = await authenticatedApi(context.env)
    const projectConfig = await loadProjectConfig(context.cwd)
    const project = await resolveProject(api, projectConfig, args.project_id)
    const { diagrams } = await api.listDiagrams(project.id)
    return result({ project, diagrams })
  }

  if (name === 'pequi_get_diagram') {
    const { api } = await authenticatedApi(context.env)
    const { diagram } = await api.getDiagram(args.diagram_id)
    return result({ diagram })
  }

  if (name === 'pequi_publish_diagram') {
    const sourcePath = args.source_path ? resolve(context.cwd, args.source_path) : null
    const content = args.content ?? (sourcePath ? await readFile(sourcePath, 'utf8') : null)
    if (!content) throw new Error('Informe content ou source_path com um diagrama Mermaid.')
    const published = await publishDiagram({
      cwd: context.cwd,
      env: context.env,
      title: args.title,
      content,
      sourcePath,
      clientKey: args.client_key,
      projectReference: args.project_id,
      diagramId: args.diagram_id,
      baseRevision: args.base_revision,
    })
    return result({
      action: published.created ? 'created' : 'updated',
      diagram: published.diagram,
      project: published.project,
    })
  }

  throw new Error(`Ferramenta MCP desconhecida: ${name}`)
}

export async function handleMcpMessage(message, context = {}) {
  const id = message.id
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pequi', version: '0.1.0' },
      },
    }
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (message.method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } }
  }
  if (message.method === 'tools/call') {
    try {
      const toolResult = await callTool(message.params?.name, message.params?.arguments || {}, {
        cwd: context.cwd || process.cwd(),
        env: context.env || process.env,
      })
      return { jsonrpc: '2.0', id, result: toolResult }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        },
      }
    }
  }
  if (message.method?.startsWith('notifications/')) return null
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Método não encontrado: ${message.method}` },
  }
}

export async function serveMcp({ input = process.stdin, output = process.stdout, cwd, env } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let response
    try {
      response = await handleMcpMessage(JSON.parse(line), { cwd, env })
    } catch (error) {
      response = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : 'JSON inválido' },
      }
    }
    if (response) output.write(`${JSON.stringify(response)}\n`)
  }
}

export { TOOL_DEFINITIONS }
