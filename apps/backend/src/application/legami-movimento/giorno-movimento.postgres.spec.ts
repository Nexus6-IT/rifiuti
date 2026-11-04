/**
 * Il «giorno italiano» del movimento (spec §4.9, decisione 7) esiste in due forme che devono dare
 * lo stesso risultato: `giornoItaliano` in codice (proposta) e `sqlGiornoMovimento` in SQL
 * (conteggio dei movimenti toccati, lista «da collegare»). Il confronto è su istanti ai bordi del
 * giorno, dell'ora legale e del cambio d'anno, contro un Postgres reale.
 */
import { PrismaClient } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { sqlGiornoMovimento } from './giorno-movimento'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('giorno del movimento: SQL e codice coincidono', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  afterAll(() => owner.$disconnect())

  const ISTANTI = [
    '2026-03-28T22:59:59.999Z', // 23:59:59 CET: ancora il 28
    '2026-03-28T23:00:00.000Z', // mezzanotte CET: il 29
    '2026-03-29T00:59:59.000Z', // un attimo prima del cambio all'ora legale
    '2026-03-29T01:00:00.000Z', // 03:00 CEST
    '2026-07-14T21:59:59.000Z', // 23:59:59 CEST: ancora il 14
    '2026-07-14T22:00:00.000Z', // mezzanotte CEST: il 15
    '2026-10-24T22:00:00.000Z', // mezzanotte CEST: il 25 (giorno del ritorno all'ora solare)
    '2026-10-25T22:59:59.000Z', // 23:59:59 CET: ancora il 25
    '2026-12-31T22:59:59.000Z',
    '2026-12-31T23:00:00.000Z', // cambio d'anno italiano
    '2026-03-01T00:00:00.000Z', // data senza ora: mezzanotte UTC
  ]

  it.each(ISTANTI)('%s', async istante => {
    // `movement_date` è un timestamp senza fuso che contiene l'istante UTC.
    const r = await owner.$queryRaw<{ giorno: string }[]>`
      SELECT to_char(${sqlGiornoMovimento('m')}, 'YYYY-MM-DD') AS giorno
      FROM (SELECT ${istante}::timestamp AS movement_date) m`
    expect(r[0].giorno).toBe(giornoItaliano(new Date(istante)))
  })

  it('non dipende dal fuso della sessione (America/New_York)', async () => {
    const istante = '2026-03-28T23:00:00.000Z' // il 29 a Roma
    const r = await owner.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`
      return tx.$queryRaw<{ giorno: string }[]>`
        SELECT to_char(${sqlGiornoMovimento('m')}, 'YYYY-MM-DD') AS giorno
        FROM (SELECT ${istante}::timestamp AS movement_date) m`
    })
    expect(r[0].giorno).toBe('2026-03-29')
  })

  it('l’alias è obbligatorio e solo un identificatore semplice (nessuna iniezione)', () => {
    expect(() => sqlGiornoMovimento('m; DROP TABLE x')).toThrow(/alias/i)
    expect(sqlGiornoMovimento('wm').sql).toContain('wm.movement_date')
  })
})
