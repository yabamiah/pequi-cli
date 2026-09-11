import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs, flagBoolean, flagString } from './args.js'
import { PequiApi } from './api.js'
import {
  clearSession,
  loadGlobalConfig,
  loadProjectConfig,
  normalizeServerUrl,
  saveGlobalConfig,
  saveProjectConfig,
} from './config.js'
import { serveMcp } from './mcp.js'
import {
  authenticatedApi,
  defaultTitle,
  publishDiagram,
  pullDiagram,
  resolveProject,
} from './workspace.js'

const HELP = `Pequi CLI — diagramas do código local para o Pequi

Uso:
  pequi login [--email EMAIL] [--server URL]
  pequi logout
  pequi whoami
  pequi link [ID_OU_SLUG]
  pequi diagram list [--project ID_OU_SLUG] [--json]
  pequi diagram push ARQUIVO [--title TÍTULO] [--project ID_OU_SLUG]
  pequi diagram pull ID [--out ARQUIVO] [--force]
  pequi mcp serve
  pequi mcp command codex|claude
  pequi mcp setup codex|claude

Ambiente:
  PEQUI_SERVER_URL  API do Pequi (padrão: http://127.0.0.1:8787/api/v1)
  PEQUI_TOKEN       sessão temporária; tem precedência sobre o arquivo local
  PEQUI_CONFIG_DIR  diretório alternativo para configuração e testes
`

function printJson(value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function login(flags) {
  const current = await loadGlobalConfig()
  const serverUrl = normalizeServerUrl(flagString(flags, 'server') || current.serverUrl)
  const terminal = createInterface({ input, output })
  try {
    const email = flagString(flags, 'email') || (await terminal.question('E-mail: ')).trim()
    if (!email) throw new Error('Informe o e-mail da conta Pequi.')

    const api = new PequiApi({ serverUrl })
    const requested = await api.requestOtp(email)
    output.write(`Código enviado para ${email}.\n`)
    if (requested.devOtp) {
      output.write(`Código do ambiente de desenvolvimento: ${requested.devOtp}\n`)
    }

    const code = flagString(flags, 'otp') || (await terminal.question('Código de 6 dígitos: ')).trim()
    const session = await api.verifyOtp(email, requested.challengeId, code)
    await saveGlobalConfig({ serverUrl, token: session.token })
    output.write(`Conectado como ${session.user.email}.\n`)
  } finally {
    terminal.close()
  }
}

async function logout() {
  const config = await loadGlobalConfig()
  if (config.token) {
    await new PequiApi(config).deleteSession().catch(() => undefined)
  }
  await clearSession()
  output.write('Sessão local do Pequi removida.\n')
}

async function whoami(flags) {
  const { api, config } = await authenticatedApi()
  const session = await api.getSession()
  const project = await loadProjectConfig()
  const value = {
    serverUrl: config.serverUrl,
    user: session.user,
    linkedProject: project.projectId
      ? { id: project.projectId, name: project.projectName || null }
      : null,
  }
  if (flagBoolean(flags, 'json')) printJson(value)
  else {
    output.write(`${value.user.email}\n`)
    output.write(value.linkedProject
      ? `Projeto: ${value.linkedProject.name || value.linkedProject.id} (${value.linkedProject.id})\n`
      : 'Projeto: nenhum vínculo local; execute `pequi link`.\n')
  }
}

async function linkProject(reference) {
  const { api } = await authenticatedApi()
  const local = await loadProjectConfig()
  const project = await resolveProject(api, local, reference)
  await saveProjectConfig({ ...local, projectId: project.id, projectName: project.name })
  output.write(`Repositório vinculado a ${project.name} (${project.id}).\n`)
}

async function listDiagrams(flags) {
  const { api } = await authenticatedApi()
  const local = await loadProjectConfig()
  const project = await resolveProject(api, local, flagString(flags, 'project'))
  const { diagrams } = await api.listDiagrams(project.id)
  if (flagBoolean(flags, 'json')) {
    printJson({ project, diagrams })
    return
  }
  output.write(`${project.name}\n`)
  if (diagrams.length === 0) {
    output.write('  Nenhum diagrama sincronizado.\n')
    return
  }
  for (const diagram of diagrams) {
    output.write(`  ${diagram.id}  r${diagram.revision}  ${diagram.title}\n`)
  }
}

async function pushFile(path, flags) {
  if (!path) throw new Error('Uso: pequi diagram push ARQUIVO [--title TÍTULO]')
  const absolutePath = resolve(process.cwd(), path)
  const content = await readFile(absolutePath, 'utf8')
  const result = await publishDiagram({
    title: flagString(flags, 'title') || defaultTitle(path),
    content,
    sourcePath: absolutePath,
    projectReference: flagString(flags, 'project'),
    diagramId: flagString(flags, 'diagram-id'),
    baseRevision: flagString(flags, 'base-revision'),
  })
  output.write(`${result.created ? 'Criado' : 'Atualizado'}: ${result.diagram.title} (${result.diagram.id}, revisão ${result.diagram.revision}).\n`)
}

async function pullFile(diagramId, flags) {
  if (!diagramId) throw new Error('Uso: pequi diagram pull ID [--out ARQUIVO]')
  const result = await pullDiagram({
    diagramId,
    outputPath: flagString(flags, 'out'),
    force: flagBoolean(flags, 'force'),
  })
  output.write(`Baixado: ${result.diagram.title} → ${result.path} (revisão ${result.diagram.revision}).\n`)
}

function mcpCommand(provider) {
  if (provider === 'codex') return ['codex', ['mcp', 'add', 'pequi', '--', 'pequi', 'mcp', 'serve']]
  if (provider === 'claude') return ['claude', ['mcp', 'add', '--transport', 'stdio', 'pequi', '--', 'pequi', 'mcp', 'serve']]
  throw new Error('Escolha `codex` ou `claude`.')
}

async function setupMcp(provider) {
  const [command, args] = mcpCommand(provider)
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', (error) => reject(new Error(`Não foi possível executar ${command}: ${error.message}`)))
    child.on('exit', (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} encerrou com código ${code}.`)))
  })
}

export async function run(argv) {
  const { positionals, flags } = parseArgs(argv)
  const [command, subcommand, target] = positionals

  if (!command || command === 'help' || flagBoolean(flags, 'help')) {
    output.write(HELP)
    return
  }
  if (command === 'login') return login(flags)
  if (command === 'logout') return logout()
  if (command === 'whoami') return whoami(flags)
  if (command === 'link') return linkProject(subcommand)

  if (command === 'diagram') {
    if (subcommand === 'list') return listDiagrams(flags)
    if (subcommand === 'push') return pushFile(target, flags)
    if (subcommand === 'pull') return pullFile(target, flags)
    throw new Error('Use `pequi diagram list`, `push` ou `pull`.')
  }

  if (command === 'mcp') {
    if (subcommand === 'serve') return serveMcp()
    if (subcommand === 'command') {
      const [program, args] = mcpCommand(target)
      output.write(`${[program, ...args].join(' ')}\n`)
      return
    }
    if (subcommand === 'setup') return setupMcp(target)
    throw new Error('Use `pequi mcp serve`, `command` ou `setup`.')
  }

  throw new Error(`Comando desconhecido: ${command}. Execute \`pequi help\`.`)
}
