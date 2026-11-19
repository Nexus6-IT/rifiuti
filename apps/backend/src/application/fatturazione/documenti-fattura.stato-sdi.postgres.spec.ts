/**
 * `statoSdi` ed `esitoFiscale` nella lista dei documenti (4.5b, T3) contro un Postgres reale, COME
 * `wasteflow_app`: la trasmissione corrente (viva, altrimenti la piu' recente), il filtro `statoSdi` e
 * il numero di query COSTANTE con 1 e con 100 documenti.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `sdi-b-lista-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'

describe('DocumentiFatturaService.lista — stato SDI (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  let servizio: DocumentiFatturaService
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    servizio = new DocumentiFatturaService(app)
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  /** Inserisce una trasmissione col proprietario (la via normale e' l'accodamento). */
  async function trasmissione(
    tenantId: string,
    documentoId: string,
    stato: string,
    creataIl: string,
    n: number
  ): Promise<void> {
    await owner.$executeRawUnsafe(
      `INSERT INTO trasmissioni_sdi (tenant_id, documento_id, provider, ambiente, nome_file, xml_sha256,
                                     stato, id_provider, ultimo_errore_codice, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'fake', 'SANDBOX', $3, repeat('a', 64), $4::stato_trasmissione_sdi,
               CASE WHEN $4 IN ('ERRORE_INVIO','DA_INVIARE','IN_INVIO','INCERTA') THEN NULL ELSE 'p' END,
               CASE WHEN $4 = 'ERRORE_INVIO' THEN 'X' ELSE NULL END,
               $5::timestamp, $5::timestamp)`,
      tenantId,
      documentoId,
      `IT00000000000_${String(n).padStart(5, '0')}.xml`,
      stato,
      creataIl
    )
  }

  /** Conta le query raw della lista, dentro la sua transazione. */
  async function contaQuery(fn: () => Promise<unknown>): Promise<number> {
    const originale = app.$transaction.bind(app) as (...a: unknown[]) => Promise<unknown>
    let n = 0
    jest.spyOn(app, '$transaction').mockImplementation(((
      cb: (tx: unknown) => Promise<unknown>,
      opz?: unknown
    ) =>
      originale(
        (tx: Record<string, unknown>) =>
          cb(
            new Proxy(tx, {
              get(t, p) {
                const v = t[p as string]
                if (p === '$queryRaw' || p === '$executeRaw') {
                  return (...a: unknown[]) => {
                    n++
                    return (v as (...x: unknown[]) => unknown).apply(t, a)
                  }
                }
                return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v
              },
            })
          ),
        opz
      )) as never)
    await fn()
    jest.restoreAllMocks()
    return n
  }

  it('senza trasmissioni: statoSdi ed esitoFiscale null', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const p = await servizio.lista(az.tenantId, { pagina: 1, dimensione: 10 })
    const riga = p.elementi.find(e => e.id === d.id)!
    expect(riga.statoSdi).toBeNull()
    expect(riga.esitoFiscale).toBeNull()
  }, 90_000)

  it('la trasmissione viva prevale su quelle chiuse; senza viva vale la piu recente; esito fiscale dedotto', async () => {
    const az = await b.t19.azienda()
    const [a, bb, c] = await b.definitivi(az, 3)
    // a: ERRORE_INVIO (vecchia) poi CONSEGNATA (viva): vale la viva.
    await trasmissione(az.tenantId, a.id, 'ERRORE_INVIO', '2026-05-01 10:00:00', 1)
    await trasmissione(az.tenantId, a.id, 'CONSEGNATA', '2026-05-02 10:00:00', 2)
    // b: solo ERRORE_INVIO.
    await trasmissione(az.tenantId, bb.id, 'ERRORE_INVIO', '2026-05-01 10:00:00', 3)
    // c: SCARTATA vecchia, ERRORE_INVIO piu' recente: vale la piu' recente.
    await trasmissione(az.tenantId, c.id, 'SCARTATA', '2026-05-01 10:00:00', 4)
    await trasmissione(az.tenantId, c.id, 'ERRORE_INVIO', '2026-05-03 10:00:00', 5)
    const p = await servizio.lista(az.tenantId, { pagina: 1, dimensione: 10 })
    const per = new Map(p.elementi.map(e => [e.id, e]))
    expect(per.get(a.id)).toMatchObject({ statoSdi: 'CONSEGNATA', esitoFiscale: 'EMESSA' })
    expect(per.get(bb.id)).toMatchObject({ statoSdi: 'ERRORE_INVIO', esitoFiscale: 'NON_EMESSA' })
    expect(per.get(c.id)).toMatchObject({ statoSdi: 'ERRORE_INVIO', esitoFiscale: 'NON_EMESSA' })
    const dettaglio = await servizio.dettaglio(az.tenantId, a.id)
    expect(dettaglio).toMatchObject({ statoSdi: 'CONSEGNATA', esitoFiscale: 'EMESSA' })
  }, 120_000)

  it('filtro statoSdi: stato esatto della trasmissione corrente, NESSUNA, valore non valido -> 400; totale coerente', async () => {
    const az = await b.t19.azienda()
    const [a, bb, c] = await b.definitivi(az, 3)
    await trasmissione(az.tenantId, a.id, 'ERRORE_INVIO', '2026-05-01 10:00:00', 1)
    await trasmissione(az.tenantId, a.id, 'INVIATA', '2026-05-02 10:00:00', 2)
    await trasmissione(az.tenantId, bb.id, 'ERRORE_INVIO', '2026-05-01 10:00:00', 3)
    const filtra = (statoSdi: string) =>
      servizio.lista(az.tenantId, { pagina: 1, dimensione: 10, statoSdi: statoSdi as never })
    const inviata = await filtra('INVIATA')
    expect(inviata.elementi.map(e => e.id)).toEqual([a.id])
    expect(inviata.totale).toBe(1)
    // «ERRORE_INVIO» non trova `a`: il suo errore e' storico, la corrente e' INVIATA.
    const errore = await filtra('ERRORE_INVIO')
    expect(errore.elementi.map(e => e.id)).toEqual([bb.id])
    const nessuna = await filtra('NESSUNA')
    expect(nessuna.elementi.map(e => e.id)).toEqual([c.id])
    expect(nessuna.totale).toBe(1)
    await expect(filtra('INVENTATO')).rejects.toMatchObject({ status: 400 })
  }, 120_000)

  it('isolamento: le trasmissioni di un altra azienda non compaiono', async () => {
    const az = await b.t19.azienda()
    const altra = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const [e] = await b.definitivi(altra, 1)
    await trasmissione(altra.tenantId, e.id, 'CONSEGNATA', '2026-05-02 10:00:00', 1)
    const p = await servizio.lista(az.tenantId, { pagina: 1, dimensione: 10 })
    expect(p.elementi.map(x => x.id)).toEqual([d.id])
    expect(p.elementi[0].statoSdi).toBeNull()
  }, 120_000)

  it('numero di query costante: la stessa con 1 e con 100 documenti', async () => {
    const uno = await b.t19.azienda()
    const [solo] = await b.definitivi(uno, 1)
    await trasmissione(uno.tenantId, solo.id, 'INVIATA', '2026-05-02 10:00:00', 1)
    const con1 = await contaQuery(() =>
      servizio.lista(uno.tenantId, { pagina: 1, dimensione: 100 })
    )

    const molti = await b.t19.azienda()
    const docs = await b.definitivi(molti, 100)
    for (const [i, d] of docs.entries()) {
      await trasmissione(
        molti.tenantId,
        d.id,
        i % 2 ? 'CONSEGNATA' : 'INVIATA',
        '2026-05-02 10:00:00',
        i
      )
    }
    let pagina
    const con100 = await contaQuery(async () => {
      pagina = await servizio.lista(molti.tenantId, { pagina: 1, dimensione: 100 })
    })
    expect((pagina as unknown as { elementi: unknown[] }).elementi).toHaveLength(100)
    expect(con100).toBe(con1)
    expect(con1).toBeGreaterThan(0)
  }, 600_000)
})
