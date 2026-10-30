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
  CF_PERSONA_VALIDO,
  creaDittaConRuolo,
  partitaIvaValida,
} from '../../../test-support/anagrafiche-di-test'
import { CostruisciPayloadRentri } from './costruisci-payload-rentri'

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
  let comuneCreato = false

  const unitaLocale = { getPrincipale: async () => ({ numIscrSito: 'OP1234ABC000001-AB0001' }) }
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = new CostruisciPayloadRentri(app, unitaLocale as never, logger as never)
    const t = await owner.tenant.create({
      data: {
        partitaIva: `RP${Date.now()}`.slice(-11),
        ragioneSociale: 'Payload RENTRI test SRL',
        country: 'IT',
      },
    })
    tenantId = t.id
    if (!(await owner.istatComune.findUnique({ where: { code: CODICE_COMUNE } }))) {
      await owner.istatComune.create({
        data: { code: CODICE_COMUNE, name: NOME_COMUNE, provinciaSigla: 'RM' },
      })
      comuneCreato = true
    }
  })

  afterAll(async () => {
    await owner.produttore.deleteMany({ where: { tenantId } })
    await owner.trasportatore.deleteMany({ where: { tenantId } })
    await owner.destinatario.deleteMany({ where: { tenantId } })
    await owner.sedeDitta.deleteMany({ where: { tenantId } })
    await owner.ditta.deleteMany({ where: { tenantId } })
    await owner.tenant.deleteMany({ where: { id: tenantId } })
    if (comuneCreato) await owner.istatComune.deleteMany({ where: { code: CODICE_COMUNE } })
    await owner.$disconnect()
    await app.$disconnect()
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

  it('denominazione, codice_fiscale e indirizzo coincidono con quelli delle colonne vecchie', async () => {
    const piva = (seme: number) => partitaIvaValida(Date.now() + seme)
    const p = await creaDittaConRuolo(owner, tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Produttore Uno SRL',
      partitaIva: piva(1),
      ...sede('Via del Produttore'),
    })
    const d = await creaDittaConRuolo(owner, tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Destinatario Due SPA',
      partitaIva: piva(2),
      ...sede('Via del Destinatario'),
    })
    const t = await creaDittaConRuolo(owner, tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti Tre SRL',
      numeroDocumento: 'MI/123456',
      partitaIva: piva(3),
      ...sede('Via del Trasportatore'),
    })
    // Valori che il codice PRIMA del cambio avrebbe letto dalle colonne vecchie della riga di ruolo
    const prima = {
      p: await owner.produttore.findUniqueOrThrow({ where: { id: p.ruoloId } }),
      d: await owner.destinatario.findUniqueOrThrow({ where: { id: d.ruoloId } }),
      t: await owner.trasportatore.findUniqueOrThrow({ where: { id: t.ruoloId } }),
    }

    const payload = (await TenantContext.run({ tenantId }, () =>
      servizio.costruisci(firCon(p.ruoloId, d.ruoloId, t.ruoloId), tenantId)
    )) as unknown as Payload

    const { produttore, destinatario, trasportatori } = payload.dati_partenza
    expect(produttore.denominazione).toBe(prima.p.ragioneSociale)
    expect(produttore.codice_fiscale).toBe(prima.p.partitaIVA)
    expect(produttore.indirizzo).toMatchObject({
      indirizzo: prima.p.via,
      civico: prima.p.civico,
      cap: prima.p.cap,
    })
    expect(destinatario.denominazione).toBe(prima.d.ragioneSociale)
    expect(destinatario.codice_fiscale).toBe(prima.d.partitaIVA)
    expect(destinatario.indirizzo).toMatchObject({ indirizzo: prima.d.via })
    expect(trasportatori[0].denominazione).toBe(prima.t.ragioneSociale)
    expect(trasportatori[0].codice_fiscale).toBe(prima.t.partitaIVA)
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
})
