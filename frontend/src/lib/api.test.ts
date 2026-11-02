import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The API client. `API_URL` and `accountsEnabled` are read at import time, so
// each test imports a fresh copy after setting the environment.

const API = 'https://api.example.test'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

async function load(env: Record<string, string> = { VITE_API_URL: `${API}//`, VITE_GOOGLE_CLIENT_ID: 'cid' }) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return {
    api: await import('./api'),
    auth: await import('./auth'),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('accountsEnabled', () => {
  it('needs both the API URL and the Google client ID', async () => {
    expect((await load({ VITE_API_URL: API, VITE_GOOGLE_CLIENT_ID: 'cid' })).api.accountsEnabled).toBe(true)
    expect((await load({ VITE_API_URL: API, VITE_GOOGLE_CLIENT_ID: '' })).api.accountsEnabled).toBe(false)
    expect((await load({ VITE_API_URL: '', VITE_GOOGLE_CLIENT_ID: 'cid' })).api.accountsEnabled).toBe(false)
  })
})

describe('token storage', () => {
  it('stores, clears and notifies subscribers', async () => {
    const { api } = await load()
    const listener = vi.fn()
    const unsubscribe = api.subscribeToken(listener)

    api.setToken('abc')
    expect(api.getToken()).toBe('abc')
    api.setToken(null)
    expect(api.getToken()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    api.setToken('def')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('survives storage that throws (private mode, policy)', async () => {
    const { api } = await load()
    const broken = memoryStorage()
    broken.getItem = () => {
      throw new Error('SecurityError')
    }
    broken.setItem = broken.getItem
    vi.stubGlobal('localStorage', broken)
    expect(api.getToken()).toBeNull()
    expect(() => api.setToken('abc')).not.toThrow()
  })
})

describe('apiFetch', () => {
  it('joins the base URL without doubled slashes and sends the bearer token', async () => {
    const { api } = await load()
    api.setToken('tok')
    fetchMock.mockResolvedValue(json(200, { ok: true }))

    expect(await api.apiFetch('/me')).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/me`)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('sends no Authorization header when signed out, and JSON content type with a body', async () => {
    const { api } = await load()
    fetchMock.mockResolvedValue(json(200, {}))
    await api.apiFetch('/auth/google', { method: 'POST', body: '{}' })
    const headers = new Headers(fetchMock.mock.calls[0][1].headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('returns undefined for 204', async () => {
    const { api } = await load()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    expect(await api.apiFetch('/me', { method: 'DELETE' })).toBeUndefined()
  })

  it('drops the session on any 401', async () => {
    const { api } = await load()
    api.setToken('stale')
    fetchMock.mockResolvedValue(json(401, { detail: 'Session expired' }))
    await expect(api.apiFetch('/me')).rejects.toMatchObject({ status: 401, message: 'Session expired' })
    expect(api.getToken()).toBeNull()
  })

  it('keeps the session on other errors and surfaces FastAPI’s detail', async () => {
    const { api } = await load()
    api.setToken('tok')
    fetchMock.mockResolvedValue(json(422, { detail: 'Bad input' }))
    await expect(api.apiFetch('/x')).rejects.toMatchObject({ status: 422, message: 'Bad input' })
    expect(api.getToken()).toBe('tok')
  })

  it('falls back to a generic message for non-JSON or structured details', async () => {
    const { api } = await load()
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 502 }))
    await expect(api.apiFetch('/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' })
    fetchMock.mockResolvedValueOnce(json(422, { detail: [{ msg: 'field required' }] }))
    await expect(api.apiFetch('/x')).rejects.toMatchObject({ message: 'Request failed (422)' })
  })

  it('reports an unreachable server as status 0', async () => {
    const { api } = await load()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await api.apiFetch('/health').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(api.ApiError)
    expect(error).toMatchObject({ status: 0, message: 'Could not reach the accounts server.' })
  })
})

describe('auth', () => {
  it('signs in by exchanging the Google credential for a stored session', async () => {
    const { api, auth } = await load()
    const user = { id: 'u1', email: 'a@example.com', name: 'A', picture_url: null, created_at: '' }
    fetchMock.mockResolvedValue(json(200, { token: 'new', expires_at: '', user }))
    expect(await auth.signInWithGoogle('jwt')).toEqual(user)
    expect(api.getToken()).toBe('new')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${API}/auth/google`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ credential: 'jwt' })
  })

  it('signs out locally even when the server is unreachable', async () => {
    const { api, auth } = await load()
    api.setToken('tok')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await auth.signOut()
    expect(api.getToken()).toBeNull()
  })

  it('keeps the session if deleting the account fails', async () => {
    const { api, auth } = await load()
    api.setToken('tok')
    fetchMock.mockResolvedValue(json(500, { detail: 'db down' }))
    await expect(auth.deleteAccount()).rejects.toThrow('db down')
    expect(api.getToken()).toBe('tok')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await auth.deleteAccount()
    expect(api.getToken()).toBeNull()
  })

  it('pingApi never throws, even unhandled', async () => {
    const { auth } = await load()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(() => auth.pingApi()).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
