const test = require('node:test')
const assert = require('node:assert/strict')
const { firmaWebhook } = require('../src/firma')

// Vettore fisso, ripetuto identico nello spec del backend (provider-sdi-fake.spec.ts): se la firma
// del fake e quella verificata dall'adattatore divergono, uno dei due test diventa rosso.
test('firma HMAC-SHA256 di "<t>.<corpo>" con vettore noto', () => {
  const firma = firmaWebhook(Buffer.from('{"id":"evt-1"}'), 'segreto-di-prova', 1700000000)
  assert.equal(
    firma,
    't=1700000000,v1=' +
      require('node:crypto')
        .createHmac('sha256', 'segreto-di-prova')
        .update('1700000000.{"id":"evt-1"}')
        .digest('hex')
  )
  assert.equal(
    firma,
    't=1700000000,v1=afa1c743636aba3cff6ab0eac143d6533c1bb0fb29468c915d97b60eeff305e6'
  )
  assert.match(firma, /^t=1700000000,v1=[0-9a-f]{64}$/)
})

test('verificaFirma: formato, firma, timestamp', () => {
  const { verificaFirma } = require('../src/firma')
  const corpo = Buffer.from('{}')
  const ora = new Date(1700000000 * 1000)
  const ok = firmaWebhook(corpo, 's', 1700000000)
  assert.equal(verificaFirma(ok, corpo, 's', ora), 'OK')
  assert.equal(verificaFirma(undefined, corpo, 's', ora), 'FORMATO')
  assert.equal(verificaFirma('boh', corpo, 's', ora), 'FORMATO')
  assert.equal(verificaFirma(ok, corpo, 'altro', ora), 'FIRMA')
  assert.equal(verificaFirma(ok, corpo, 's', new Date((1700000000 + 301) * 1000)), 'TIMESTAMP')
})
