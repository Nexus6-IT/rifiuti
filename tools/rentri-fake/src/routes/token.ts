import { FastifyInstance } from 'fastify'

/**
 * RENTRI non espone alcun endpoint /token: l'autenticazione è ID_AUTH_REST_02
 * (JWT self-issued passato direttamente come Bearer). Registriamo la rotta
 * apposta per rispondere 404 con un corpo esplicito: serve a far fallire in
 * modo comprensibile qualunque client che tenti un OAuth2 client_credentials.
 */
export function registraRotteToken(app: FastifyInstance): void {
  const rispondi404 = async (_richiesta: unknown, risposta: import('fastify').FastifyReply) =>
    risposta.status(404).send({
      titolo: 'Risorsa non trovata',
      dettaglio:
        "RENTRI non espone un endpoint /token. L'autenticazione è ID_AUTH_REST_02: " +
        'JWT self-issued firmato localmente e passato come Authorization: Bearer.',
    })

  app.post('/token', rispondi404)
  app.get('/token', rispondi404)
}
