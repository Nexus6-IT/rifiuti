import { PrismaClient } from '@prisma/client'

/**
 * Helper per i test Postgres: apre un `PrismaClient` collegato DAVVERO come un
 * ruolo database (es. `wasteflow_app`, `wasteflow_sistema`), partendo da
 * `DATABASE_URL` (stesso host, porta, database e schema, cambiano solo utente
 * e password). Il chiamante chiude il client con `$disconnect`.
 *
 * `urlBase` serve a chi sovrascrive `DATABASE_URL` per far collegare i servizi
 * dell'applicazione come `wasteflow_app`: deve passare l'URL del proprietario.
 *
 * Sta accanto a `prisma.service.ts` perche' in `src/` non esiste una cartella
 * di supporto ai test; e' innocuo in produzione: importa solo `@prisma/client`,
 * nessun codice applicativo lo importa e legge l'ambiente solo se invocato.
 */
export function urlComeRuolo(
  ruolo: string,
  password: string,
  urlBase: string = process.env.DATABASE_URL as string
): string {
  const url = new URL(urlBase)
  url.username = ruolo
  url.password = encodeURIComponent(password)
  return url.toString()
}

export function clientComeRuolo(
  ruolo: string,
  password: string,
  urlBase: string = process.env.DATABASE_URL as string
): PrismaClient {
  return new PrismaClient({ datasourceUrl: urlComeRuolo(ruolo, password, urlBase) })
}
