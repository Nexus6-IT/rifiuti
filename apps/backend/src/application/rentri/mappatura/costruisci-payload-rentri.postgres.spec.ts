/**
 * Payload RENTRI costruito da righe reali di ditta, sede e ruolo (F2-10, Task 3b-1, I7) contro un
 * Postgres reale, collegato COME `wasteflow_app` (RLS soggetta alle policy), dentro il
 * `TenantContext`. Un mock che restituisce la forma sbagliata passerebbe sempre: qui i campi
 * letti (`ditta`, `sede`) sono quelli veri del database.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_VALIDO,
  creaDittaConRuolo,
  partitaIvaValida,
} from '../../../test-support/anagrafiche-di-test'
import { CostruisciPayloadRentri } from './costruisci-payload-rentri'
import { DatoMancantePerRentriError } from './mappa-parti'

// Comune di prova: la tabella `istat_comuni` e' condivisa e puo' essere vuota nel database di test
const CODICE_COMUNE = '999901'
const NOME_COMUNE = 'Comuneprovaf210'

interface Payload {
  dati_partenza: {
    produttore: {
      denominazione: string
      codice_fiscale: string
      indirizzo: Record<string, unknown>
    }
    destinatario: {
      denominazione: string
      codice_fiscale: string
      indirizzo: Record<string, unknown>
    }
    trasportatori: Array<{ denominazione: string; codice_fiscale: string }>
  }
}

describe('CostruisciPayloadRentri — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: CostruisciPayloadRentri
  let tenantId: string
  const tenantCreati: string[] = []
  let comuneCreato = false

  const unitaLocale = { getPrincipale: async () => ({ numIscrSito: 'OP1234ABC000001-AB0001' }) }
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = new CostruisciPayloadRentri(app, unitaLocale as never, logger as never)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now()),
        ragioneSociale: 'Payload RENTRI test SRL',
        country: 'IT',
      },
    })
    tenantId = t.id
    tenantCreati.push(t.id)
    if (!(await owner.istatComune.findUnique({ where: { code: CODICE_COMUNE } }))) {
      await owner.istatComune.create({
        data: { code: CODICE_COMUNE, name: NOME_COMUNE, provinciaSigla: 'RM' },
      })
      comuneCreato = true
    }
  })

  afterAll(async () => {
    // Mai una cancellazione senza id esatti: se il beforeAll e' fallito prima di creare il tenant
    // un filtro `undefined` verrebbe ignorato da Prisma e cancellerebbe tutto.
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.produttore.deleteMany({ where })
      await owner.trasportatore.deleteMany({ where })
      await owner.destinatario.deleteMany({ where })
      await owner.sedeDitta.deleteMany({ where })
      await owner.ditta.deleteMany({ where })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    if (comuneCreato) await owner.istatComune.deleteMany({ where: { code: CODICE_COMUNE } })
    await owner.$disconnect()
    await app?.$disconnect()
  })

  const firCon = (p: string, d: string, t: string) =>
    ({
      id: 'fir-1',
      tenantId,
      provenienza: 'SPECIALE',
      tipoTrattaPrincipale: 'TERRESTRE',
      produttore: { registroId: p },
      destinatario: { registroId: d },
      trasportatore: { registroId: t },
      rifiuto: { cerCode: '150106', statoFisico: 'Solido', descrizione: 'Imballaggi misti' },
    }) as never

  const sede = (via: string) => ({
    via,
    civico: '7',
    cap: '00100',
    comune: NOME_COMUNE,
    provincia: 'RM',
  })

  it('denominazione, codice_fiscale e indirizzo vengono dalla ditta e dalla sede (colonne vecchie vuote)', async () => {
    const piva = (seme: number) => partitaIvaValida(Date.now() + seme)
    const [pivaP, pivaD, pivaT] = [piva(1), piva(2), piva(3)]
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Produttore Uno SRL',
      partitaIva: pivaP,
      ...sede('Via del Produttore'),
    })
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Destinatario Due SPA',
      partitaIva: pivaD,
      ...sede('Via del Destinatario'),
    })
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti Tre SRL',
      numeroDocumento: 'MI/123456',
      partitaIva: pivaT,
      ...sede('Via del Trasportatore'),
    })

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(firCon(p.ruoloId, d.ruoloId, t.ruoloId), tenantId)
    )) as unknown as Payload

    const { produttore, destinatario, trasportatori } = payload.dati_partenza
    expect(produttore.denominazione).toBe('Produttore Uno SRL')
    expect(produttore.codice_fiscale).toBe(pivaP)
    expect(produttore.indirizzo).toMatchObject({
      indirizzo: 'Via del Produttore',
      civico: '7',
      cap: '00100',
    })
    expect(destinatario.denominazione).toBe('Destinatario Due SPA')
    expect(destinatario.codice_fiscale).toBe(pivaD)
    expect(destinatario.indirizzo).toMatchObject({ indirizzo: 'Via del Destinatario' })
    expect(trasportatori[0].denominazione).toBe('Trasporti Tre SRL')
    expect(trasportatori[0].codice_fiscale).toBe(pivaT)
  })

  it('con un codice fiscale sulla ditta, codice_fiscale e quello e non la partita IVA', async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Ditta Individuale',
      partitaIva: partitaIvaValida(Date.now() + 11),
      codiceFiscale: CF_PERSONA_VALIDO,
      ...sede('Via Uno'),
    })
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Due'))
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ...sede('Via Tre'),
      numeroDocumento: 'MI/123456',
    })

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(firCon(p.ruoloId, d.ruoloId, t.ruoloId), tenantId)
    )) as unknown as Payload

    expect(payload.dati_partenza.produttore.codice_fiscale).toBe(CF_PERSONA_VALIDO)
  })

  it('produttore privato (solo codice fiscale di 16 caratteri): codice_fiscale e quello (I7)', async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Mario Rossi',
      partitaIva: null,
      codiceFiscale: CF_PERSONA_ALTRO,
      ...sede('Via Privato'),
    })
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Due'))
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ...sede('Via Tre'),
      numeroDocumento: 'MI/123456',
    })

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(firCon(p.ruoloId, d.ruoloId, t.ruoloId), tenantId)
    )) as unknown as Payload

    expect(CF_PERSONA_ALTRO).toHaveLength(16)
    expect(payload.dati_partenza.produttore.codice_fiscale).toBe(CF_PERSONA_ALTRO)
    expect(payload.dati_partenza.produttore.denominazione).toBe('Mario Rossi')
  })

  it("l'indirizzo viene dalla sede della ditta, non dalla copia sulla riga di ruolo", async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', sede('Via Vecchia'))
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Due'))
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ...sede('Via Tre'),
      numeroDocumento: 'MI/123456',
    })
    await owner.sedeDitta.update({ where: { id: p.sedeId }, data: { via: 'Via Nuova' } })

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(firCon(p.ruoloId, d.ruoloId, t.ruoloId), tenantId)
    )) as unknown as Payload

    expect(payload.dati_partenza.produttore.indirizzo).toMatchObject({ indirizzo: 'Via Nuova' })
  })

  // --- D9.8: la sede e' quella scelta sul FIR ---

  const firConSedi = (
    p: { ruoloId: string; sedeId?: string },
    d: { ruoloId: string; sedeId?: string },
    t: string
  ) =>
    ({
      id: 'fir-2',
      tenantId,
      provenienza: 'SPECIALE',
      tipoTrattaPrincipale: 'TERRESTRE',
      produttore: { registroId: p.ruoloId, sedeId: p.sedeId },
      destinatario: { registroId: d.ruoloId, sedeId: d.sedeId },
      trasportatore: { registroId: t },
      rifiuto: { cerCode: '150106', statoFisico: 'Solido', descrizione: 'Imballaggi misti' },
    }) as never

  const altraSede = (dittaId: string, via: string) =>
    owner.sedeDitta.create({ data: { tenantId, dittaId, ...sede(via), principale: false } })

  it('FIR sulla seconda sede: indirizzo della seconda, non della predefinita', async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', sede('Via Prima'))
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Due'))
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ...sede('Via Tre'),
      numeroDocumento: 'MI/123456',
    })
    const seconda = await altraSede(p.dittaId, 'Via Seconda')

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(
        firConSedi({ ruoloId: p.ruoloId, sedeId: seconda.id }, d, t.ruoloId),
        tenantId
      )
    )) as unknown as Payload

    expect(payload.dati_partenza.produttore.indirizzo).toMatchObject({ indirizzo: 'Via Seconda' })
    expect(payload.dati_partenza.destinatario.indirizzo).toMatchObject({
      indirizzo: 'Via Due',
    })
  })

  it('FIR precedente (sede NULL): indirizzo della sede predefinita', async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', sede('Via Predefinita'))
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Due'))
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ...sede('Via Tre'),
      numeroDocumento: 'MI/123456',
    })
    await altraSede(p.dittaId, 'Via Altra')

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(firConSedi(p, d, t.ruoloId), tenantId)
    )) as unknown as Payload

    expect(payload.dati_partenza.produttore.indirizzo).toMatchObject({
      indirizzo: 'Via Predefinita',
    })
  })

  it("una sede di un'altra ditta forzata nel database: errore, mai l'indirizzo altrui", async () => {
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', sede('Via Mia'))
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Due'))
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ...sede('Via Tre'),
      numeroDocumento: 'MI/123456',
    })
    const estranea = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', sede('Via Altrui'))

    await expect(
      TenantContext.run({ tenantId }, () =>
        servizio.costruisci(
          firConSedi({ ruoloId: p.ruoloId, sedeId: estranea.sedeId }, d, t.ruoloId),
          tenantId
        )
      )
    ).rejects.toBeInstanceOf(DatoMancantePerRentriError)
  })
})
