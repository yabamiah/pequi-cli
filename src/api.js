export class PequiApiError extends Error {
  constructor(message, status, code, details) {
    super(message)
    this.name = 'PequiApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class PequiApi {
  constructor({ serverUrl, token = null, fetchImpl = fetch }) {
    this.serverUrl = serverUrl.replace(/\/+$/, '')
    this.token = token
    this.fetchImpl = fetchImpl
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (this.token) headers.set('authorization', `Bearer ${this.token}`)

    let response
    try {
      response = await this.fetchImpl(`${this.serverUrl}${path}`, {
        ...options,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch (error) {
      throw new PequiApiError(`Não foi possível conectar ao Pequi em ${this.serverUrl}.`, 0, 'NETWORK_ERROR', error)
    }

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new PequiApiError(
        payload.error?.message || `A API do Pequi respondeu com HTTP ${response.status}.`,
        response.status,
        payload.error?.code || 'API_ERROR',
        payload.error?.details,
      )
    }
    return payload.data
  }

  requestOtp(email) {
    return this.request('/auth/otp/request', { method: 'POST', body: { email } })
  }

  verifyOtp(email, challengeId, code) {
    return this.request('/auth/otp/verify', { method: 'POST', body: { email, challengeId, code } })
  }

  getSession() {
    return this.request('/auth/session')
  }

  deleteSession() {
    return this.request('/auth/session', { method: 'DELETE' })
  }

  listProjects() {
    return this.request('/projects')
  }

  listDiagrams(projectId) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/diagrams`)
  }

  getDiagram(diagramId) {
    return this.request(`/diagrams/${encodeURIComponent(diagramId)}`)
  }

  createDiagram(projectId, input) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/diagrams`, {
      method: 'POST',
      body: input,
    })
  }

  updateDiagram(diagramId, input) {
    return this.request(`/diagrams/${encodeURIComponent(diagramId)}`, {
      method: 'PUT',
      body: input,
    })
  }
}
