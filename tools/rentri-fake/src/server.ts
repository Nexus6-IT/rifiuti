import { creaApp } from './app'

const PORTA = Number(process.env.PORT ?? 4010)

async function avvia(): Promise<void> {
  const app = creaApp()
  await app.listen({ port: PORTA, host: '0.0.0.0' })
  // eslint-disable-next-line no-console
  console.log(`rentri-fake in ascolto sulla porta ${PORTA}`)
}

avvia().catch((errore) => {
  // eslint-disable-next-line no-console
  console.error('Avvio fallito:', errore)
  process.exit(1)
})
