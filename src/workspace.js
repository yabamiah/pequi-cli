import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PequiApi, PequiApiError } from './api.js'
import {
  loadGlobalConfig,
  loadProjectConfig,
  relativeProjectPath,
  saveProjectConfig,
} from './config.js'

const execFileAsync = promisify(execFile)

export async function authenticatedApi(env = process.env) {
  const config = await loadGlobalConfig(env)
  if (!config.token) {
    throw new Error('Você ainda não entrou no Pequi. Execute `pequi login`.')
  }
  return { api: new PequiApi(config), config }
}

export async function resolveProject(api, projectConfig, explicitProject) {
  const { projects } = await api.listProjects()
  const reference = explicitProject || projectConfig.projectId
  const project = reference
    ? projects.find((candidate) => candidate.id === reference || candidate.slug === reference)
    : projects[0]

  if (!project) {
    if (reference) throw new Error(`O projeto Pequi "${reference}" não foi encontrado.`)
    throw new Error('A conta ainda não possui um projeto Pequi.')
  }
  return project
}

export async function currentGitCommit(cwd = process.cwd()) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export function defaultTitle(path) {
  const filename = basename(path)
  return filename.slice(0, filename.length - extname(filename).length) || filename
}

export async function publishDiagram({
  cwd = process.cwd(),
  env = process.env,
  title,
  content,
  sourcePath,
  clientKey,
  projectReference,
  diagramId,
  baseRevision,
  gitCommit,
}) {
  const { api } = await authenticatedApi(env)
  const projectConfig = await loadProjectConfig(cwd)
  const project = await resolveProject(api, projectConfig, projectReference)
  const mappingKey = clientKey || (sourcePath ? relativeProjectPath(sourcePath, cwd) : null)
  const mapped = mappingKey ? projectConfig.diagrams?.[mappingKey] : null
  const targetId = diagramId || mapped?.id
  const targetRevision = Number(baseRevision || mapped?.revision)
  const metadata = {
    sourcePath: sourcePath ? relativeProjectPath(sourcePath, cwd) : mappingKey,
    gitCommit: gitCommit || await currentGitCommit(cwd),
  }

  let diagram
  let created = false
  try {
    if (targetId) {
      if (!Number.isInteger(targetRevision) || targetRevision < 1) {
        throw new Error('Informe --base-revision ou faça `pequi diagram pull` antes de atualizar.')
      }
      ;({ diagram } = await api.updateDiagram(targetId, {
        title,
        content,
        baseRevision: targetRevision,
        ...metadata,
      }))
    } else {
      ;({ diagram } = await api.createDiagram(project.id, {
        title,
        content,
        clientKey: mappingKey || undefined,
        ...metadata,
      }))
      created = true
    }
  } catch (error) {
    if (error instanceof PequiApiError && error.code === 'revision_conflict') {
      const remote = error.details?.diagram
      const remoteHint = remote ? ` A revisão remota atual é ${remote.revision}.` : ''
      throw new Error(`Conflito de revisão: faça pull antes de sobrescrever.${remoteHint}`)
    }
    throw error
  }

  const nextConfig = {
    ...projectConfig,
    projectId: project.id,
    projectName: project.name,
    diagrams: {
      ...(projectConfig.diagrams || {}),
      ...(mappingKey ? { [mappingKey]: { id: diagram.id, revision: diagram.revision } } : {}),
    },
  }
  await saveProjectConfig(nextConfig, cwd)
  return { diagram, project, created, mappingKey }
}

export async function pullDiagram({
  cwd = process.cwd(),
  env = process.env,
  diagramId,
  outputPath,
  force = false,
}) {
  const { api } = await authenticatedApi(env)
  const { diagram } = await api.getDiagram(diagramId)
  const projectConfig = await loadProjectConfig(cwd)
  const mappedEntry = Object.entries(projectConfig.diagrams || {})
    .find(([, value]) => value.id === diagram.id)
  const relativePath = outputPath
    ? relativeProjectPath(outputPath, cwd)
    : mappedEntry?.[0] || `${diagram.title.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase() || diagram.id}.mmd`
  const absolutePath = resolve(cwd, relativePath)

  if (!force) {
    try {
      const existing = await readFile(absolutePath, 'utf8')
      if (existing !== diagram.content) {
        throw new Error(`O arquivo ${relativePath} tem alterações locais. Use --force para substituí-lo.`)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, diagram.content, 'utf8')
  await saveProjectConfig({
    ...projectConfig,
    projectId: diagram.projectId,
    diagrams: {
      ...(projectConfig.diagrams || {}),
      [relativePath]: { id: diagram.id, revision: diagram.revision },
    },
  }, cwd)
  return { diagram, path: relativePath }
}
