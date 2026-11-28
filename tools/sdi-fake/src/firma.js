'use strict'
/**
 * Firma del webhook: intestazione `x-sdi-signature: t=<secondi unix>,v1=<hmac sha256 esadecimale>`,
 * HMAC di `<t>.<corpo>`. E' lo stesso schema di `firmaWebhookFake` / `interpretaWebhook` del backend
 * (apps/backend/src/infrastructure/sdi/fake/provider-sdi-fake.ts): i due test con lo stesso vettore
 * tengono allineate le due copie.
 */
const { createHmac, timingSafeEqual } = require('node:crypto')

const INTESTAZIONE_FIRMA = 'x-sdi-signature'
const TOLLERANZA_SECONDI = 300

function firmaWebhook(corpo, segreto, t) {
  const hmac = createHmac('sha256', segreto).update(`${t}.`).update(corpo).digest('hex')
  return `t=${t},v1=${hmac}`
}

/** @returns {'OK'|'FORMATO'|'FIRMA'|'TIMESTAMP'} */
function verificaFirma(intestazione, corpo, segreto, ora) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(intestazione ?? '')
  if (!m) return 'FORMATO'
  const t = Number(m[1])
  const attesa = Buffer.from(firmaWebhook(corpo, segreto, t).split('v1=')[1], 'hex')
  const ricevuta = Buffer.from(m[2], 'hex')
  if (attesa.length !== ricevuta.length || !timingSafeEqual(attesa, ricevuta)) return 'FIRMA'
  if (Math.abs(Math.floor(ora.getTime() / 1000) - t) > TOLLERANZA_SECONDI) return 'TIMESTAMP'
  return 'OK'
}

module.exports = { INTESTAZIONE_FIRMA, firmaWebhook, verificaFirma }
