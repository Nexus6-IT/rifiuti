'use strict'
const { creaServer } = require('./app')

const porta = Number(process.env.PORT ?? 4020)
const ritardo = process.env.SDI_FAKE_RITARDO_WEBHOOK_MS
const { server } = creaServer(ritardo === undefined ? {} : { ritardoWebhookMs: Number(ritardo) })
server.listen(porta, '0.0.0.0', () => {
  console.log(`sdi-fake in ascolto sulla porta ${porta}`)
})
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => process.exit(0)))
