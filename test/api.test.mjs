import assert from 'node:assert/strict'
import test from 'node:test'
import { PequiApi } from '../src/api.js'

test('verificação do OTP envia o desafio junto com o código', async () => {
  let request
  const api = new PequiApi({
    serverUrl: 'https://pequi.test/api/v1',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response(JSON.stringify({ data: { token: 'pqt_test' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  await api.verifyOtp('pessoa@example.com', 'otp_123', '123456')
  assert.equal(request.url, 'https://pequi.test/api/v1/auth/otp/verify')
  assert.deepEqual(JSON.parse(request.options.body), {
    email: 'pessoa@example.com',
    challengeId: 'otp_123',
    code: '123456',
  })
})
