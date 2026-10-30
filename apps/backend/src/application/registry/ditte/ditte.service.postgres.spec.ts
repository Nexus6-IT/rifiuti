/**
 * Ditte e sedi (F2-10, Task 2) contro un Postgres reale, collegato COME `wasteflow_app` (RLS
 * ENABLE+FORCE soggetta alle policy), dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`, superuser) prepara le aziende e le righe di ruolo e legge cio' che
 * e' stato scritto; la pulizia toglie solo le righe create qui, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  DatiControparteNonValidiError,
  DittaIdentificativiInConflittoError,
  DittaNonTrovataError,
  IdentificativoNonCorrispondenteError,
  SedeNonModificabileError,
} from '../../../core/domain/errors'
import { RuoloControparte } from '../../../domain/registry/entities/sede-ditta'
import { DittaPrismaRepository } from '../../../infrastructure/persistence/ditta-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_VALIDO,
  PIVA_CHECKSUM_ERRATO,
  PIVA_VALIDA,
  partitaIvaValida,
} from '../../../test-support/anagrafiche-di-test'
import { DatiRisoluzioneRuolo, DitteService } from './ditte.service'

const INDIRIZZO = { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' }

describe('DitteService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let app2: PrismaService
  let service: DitteService
  let service2: DitteService
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `DT${suffisso}`, ragioneSociale: 'Ditte test SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const dati = (over: Partial<DatiRisoluzioneRuolo> = {}): DatiRisoluzioneRuolo => ({
    ragioneSociale: 'Rossi S.r.l.',
    partitaIva: PIVA_VALIDA,
    indirizzo: INDIRIZZO,
    ...over,
  })

  /** `risolviPerRuolo` in una transazione propria (nel test il "chiamante" e' questa funzione). */
  const risolvi = (
    tenantId: string,
    ruolo: RuoloControparte,
    d: DatiRisoluzioneRuolo,
    s: { prisma: PrismaService; servizio: DitteService } = { prisma: app, servizio: service }
  ) =>
    nelTenant(tenantId, () => s.prisma.$transaction(tx => s.servizio.risolviPerRuolo(tx, ruolo, d)))

  const dittePerTenant = (tenantId: string) => owner.ditta.findMany({ where: { tenantId } })

  beforeAll(async () => {
    // Prima di toccare il database: mai su un database che non sia quello di test locale.
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    app2 = creaPrismaServiceApplicativo()
    service = new DitteService(app, new DittaPrismaRepository())
    service2 = new DitteService(app2, new DittaPrismaRepository())
  })

  afterAll(async () => {
    for (const tenantId of tenantCreati) {
      await owner.produttore.deleteMany({ where: { tenantId } })
      await owner.trasportatore.deleteMany({ where: { tenantId } })
      await owner.destinatario.deleteMany({ where: { tenantId } })
      await owner.activityLog.deleteMany({ where: { tenantId } })
      await owner.sedeDitta.deleteMany({ where: { tenantId } })
      await owner.ditta.deleteMany({ where: { tenantId } })
    }
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await owner.$disconnect()
    await app.$disconnect()
    await app2.$disconnect()
  })

  it('creazione nuova: ditta con una sola sede, principale', async () => {
    const t = await azienda()
    const r = await risolvi(t, 'PRODUTTORE', dati())
    expect(r.dittaEsistente).toBe(false)
    expect(r.avvisi).toEqual([])
    const ditte = await dittePerTenant(t)
    expect(ditte).toHaveLength(1)
    expect(ditte[0]).toMatchObject({ partitaIva: PIVA_VALIDA, codiceFiscale: null })
    const sedi = await owner.sedeDitta.findMany({ where: { tenantId: t } })
    expect(sedi).toHaveLength(1)
    expect(sedi[0]).toMatchObject({ id: r.sedeId, principale: true, attiva: true, comune: 'Roma' })
  })

  it('riuso per P.IVA da un altro ruolo, con avviso se il nome differisce', async () => {
    const t = await azienda()
    const a = await risolvi(t, 'PRODUTTORE', dati())
    const b = await risolvi(t, 'DESTINATARIO', dati({ ragioneSociale: 'ROSSI SPA' }))
    expect(b.dittaId).toBe(a.dittaId)
    expect(b.sedeId).toBe(a.sedeId)
    expect(b.dittaEsistente).toBe(true)
    expect(b.ragioneSocialeDitta).toBe('Rossi S.r.l.')
    expect(b.avvisi).toHaveLength(1)
    expect(await dittePerTenant(t)).toHaveLength(1)
  })

  it('riuso per CF numerico uguale alla P.IVA', async () => {
    const t = await azienda()
    const a = await risolvi(t, 'PRODUTTORE', dati())
    const b = await risolvi(
      t,
      'TRASPORTATORE',
      dati({ partitaIva: undefined, codiceFiscale: PIVA_VALIDA })
    )
    expect(b.dittaId).toBe(a.dittaId)
    expect(await dittePerTenant(t)).toHaveLength(1)
  })

  it('aggiunta del CF mancante a una ditta esistente', async () => {
    const t = await azienda()
    const a = await risolvi(t, 'PRODUTTORE', dati())
    const b = await risolvi(t, 'PRODUTTORE', dati({ codiceFiscale: CF_PERSONA_VALIDO }))
    expect(b.dittaId).toBe(a.dittaId)
    const [ditta] = await dittePerTenant(t)
    expect(ditta.codiceFiscale).toBe(CF_PERSONA_VALIDO)
  })

  it('CF contraddittorio con quello registrato: 400, ditta invariata', async () => {
    const t = await azienda()
    await risolvi(t, 'PRODUTTORE', dati({ codiceFiscale: CF_PERSONA_VALIDO }))
    const p = risolvi(t, 'PRODUTTORE', dati({ codiceFiscale: CF_PERSONA_ALTRO }))
    await expect(p).rejects.toBeInstanceOf(IdentificativoNonCorrispondenteError)
    await p.catch(e => {
      expect(e.message).not.toContain(CF_PERSONA_ALTRO)
      expect(e.message).not.toContain(CF_PERSONA_VALIDO)
    })
    const [ditta] = await dittePerTenant(t)
    expect(ditta.codiceFiscale).toBe(CF_PERSONA_VALIDO)
  })

  it('P.IVA e CF di due ditte diverse: 409', async () => {
    const t = await azienda()
    await risolvi(t, 'PRODUTTORE', dati())
    await risolvi(
      t,
      'PRODUTTORE',
      dati({ partitaIva: undefined, codiceFiscale: CF_PERSONA_VALIDO })
    )
    await expect(
      risolvi(t, 'PRODUTTORE', dati({ codiceFiscale: CF_PERSONA_VALIDO }))
    ).rejects.toBeInstanceOf(DittaIdentificativiInConflittoError)
    expect(await dittePerTenant(t)).toHaveLength(2)
  })

  it('due risolviPerRuolo concorrenti (due client) producono una sola ditta', async () => {
    const t = await azienda()
    const [a, b] = await Promise.all([
      risolvi(t, 'PRODUTTORE', dati(), { prisma: app, servizio: service }),
      risolvi(t, 'DESTINATARIO', dati(), { prisma: app2, servizio: service2 }),
    ])
    expect(a.dittaId).toBe(b.dittaId)
    expect([a.dittaEsistente, b.dittaEsistente].sort()).toEqual([false, true])
    expect(await dittePerTenant(t)).toHaveLength(1)
    expect(await owner.sedeDitta.count({ where: { tenantId: t } })).toBe(1)
  })

  it('sede riusata con indirizzo normalizzato uguale, nuova non principale altrimenti', async () => {
    const t = await azienda()
    const a = await risolvi(t, 'PRODUTTORE', dati())
    const stessa = await risolvi(
      t,
      'DESTINATARIO',
      dati({ indirizzo: { ...INDIRIZZO, via: '  VIA   ROMA ', citta: 'ROMA', provincia: 'rm' } })
    )
    expect(stessa.sedeId).toBe(a.sedeId)
    const altra = await risolvi(
      t,
      'TRASPORTATORE',
      dati({ indirizzo: { ...INDIRIZZO, via: "Via dell'Industria", civico: '5' } })
    )
    expect(altra.sedeId).not.toBe(a.sedeId)
    const sedi = await owner.sedeDitta.findMany({
      where: { tenantId: t },
      orderBy: { createdAt: 'asc' },
    })
    expect(sedi.map(s => s.principale)).toEqual([true, false])
  })

  it('sede riusata: i contatti vuoti si riempiono con quelli della richiesta, risposta coerente col DB', async () => {
    const t = await azienda()
    const a = await risolvi(t, 'PRODUTTORE', dati())
    const b = await risolvi(
      t,
      'DESTINATARIO',
      dati({ email: 'uffici@rossi.it', telefono: '0612345678', pec: 'rossi@pec.it' })
    )
    expect(b.sedeId).toBe(a.sedeId)
    expect(b.avvisi).toEqual([])
    expect(b.contatti).toEqual({
      email: 'uffici@rossi.it',
      telefono: '0612345678',
      pec: 'rossi@pec.it',
    })
    const sede = await owner.sedeDitta.findUniqueOrThrow({ where: { id: a.sedeId } })
    expect(sede).toMatchObject({
      email: 'uffici@rossi.it',
      telefono: '0612345678',
      pec: 'rossi@pec.it',
    })
  })

  it('sede riusata con PEC diversa: resta quella della sede, un solo avviso, risposta coerente', async () => {
    const t = await azienda()
    const a = await risolvi(t, 'PRODUTTORE', dati({ pec: 'prima@pec.it', email: 'a@rossi.it' }))
    const b = await risolvi(
      t,
      'DESTINATARIO',
      dati({ pec: 'altra@pec.it', email: 'b@rossi.it', telefono: '0611111111' })
    )
    expect(b.sedeId).toBe(a.sedeId)
    expect(b.avvisi).toEqual([
      'La sede esistente ha già dei contatti: sono stati mantenuti quelli della sede. Per cambiarli usa "Sedi".',
    ])
    expect(b.contatti).toEqual({
      email: 'a@rossi.it',
      telefono: '0611111111',
      pec: 'prima@pec.it',
    })
    const sede = await owner.sedeDitta.findUniqueOrThrow({ where: { id: a.sedeId } })
    expect(sede).toMatchObject({
      email: 'a@rossi.it',
      telefono: '0611111111',
      pec: 'prima@pec.it',
    })
  })

  it('un privato come trasportatore o destinatario: errore e nessuna ditta', async () => {
    const t = await azienda()
    for (const ruolo of ['TRASPORTATORE', 'DESTINATARIO'] as const) {
      await expect(
        risolvi(t, ruolo, dati({ partitaIva: undefined, codiceFiscale: CF_PERSONA_VALIDO }))
      ).rejects.toBeInstanceOf(DatiControparteNonValidiError)
    }
    expect(await dittePerTenant(t)).toHaveLength(0)
    // come produttore e ammesso
    const r = await risolvi(
      t,
      'PRODUTTORE',
      dati({ partitaIva: undefined, codiceFiscale: CF_PERSONA_VALIDO })
    )
    expect(r.dittaEsistente).toBe(false)
  })

  describe('sostituzione della P.IVA (I3)', () => {
    async function dittaConPartitaIvaSbagliata(t: string) {
      const ditta = await owner.ditta.create({
        data: { tenantId: t, ragioneSociale: 'Verdi', partitaIva: PIVA_CHECKSUM_ERRATO },
      })
      return ditta.id
    }

    it('P.IVA senza checksum sostituita con una valida: audit presente, senza valori', async () => {
      const t = await azienda()
      const id = await dittaConPartitaIvaSbagliata(t)
      const nuova = partitaIvaValida(555)
      const dto = await nelTenant(t, () => service.aggiornaDitta(id, { partitaIva: nuova }))
      expect(dto.partitaIva).toBe(nuova)
      expect(dto.partitaIvaDaVerificare).toBe(false)
      const audit = await owner.activityLog.findMany({
        where: { tenantId: t, action: 'DITTA_PARTITA_IVA_CORRETTA' },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0].metadata).toEqual({ dittaId: id })
      const testo = JSON.stringify(audit[0])
      expect(testo).not.toContain(nuova)
      expect(testo).not.toContain(PIVA_CHECKSUM_ERRATO)
    })

    it('P.IVA attuale valida: rifiutata, nessun audit', async () => {
      const t = await azienda()
      const r = await risolvi(t, 'PRODUTTORE', dati())
      await expect(
        nelTenant(t, () => service.aggiornaDitta(r.dittaId, { partitaIva: partitaIvaValida(556) }))
      ).rejects.toBeInstanceOf(IdentificativoNonCorrispondenteError)
      expect(await owner.activityLog.count({ where: { tenantId: t } })).toBe(0)
      expect((await dittePerTenant(t))[0].partitaIva).toBe(PIVA_VALIDA)
    })

    it('nuova P.IVA gia di un altra ditta: 409', async () => {
      const t = await azienda()
      const id = await dittaConPartitaIvaSbagliata(t)
      await risolvi(t, 'PRODUTTORE', dati()) // ditta con PIVA_VALIDA
      await expect(
        nelTenant(t, () => service.aggiornaDitta(id, { partitaIva: PIVA_VALIDA }))
      ).rejects.toBeInstanceOf(DittaIdentificativiInConflittoError)
      expect(await owner.activityLog.count({ where: { tenantId: t } })).toBe(0)
    })
  })

  describe('sedi', () => {
    it('impostaPrincipale lascia una sola principale', async () => {
      const t = await azienda()
      const r = await risolvi(t, 'PRODUTTORE', dati())
      const s2 = await nelTenant(t, () =>
        service.aggiungiSede(r.dittaId, { indirizzo: { ...INDIRIZZO, civico: '2' } })
      )
      const s3 = await nelTenant(t, () =>
        service.aggiungiSede(r.dittaId, { indirizzo: { ...INDIRIZZO, civico: '3' } })
      )
      expect([s2.principale, s3.principale]).toEqual([false, false])
      await nelTenant(t, () => service.impostaPrincipale(r.dittaId, s3.id))
      await nelTenant(t, () => service.impostaPrincipale(r.dittaId, s2.id))
      const sedi = await owner.sedeDitta.findMany({ where: { tenantId: t } })
      expect(sedi.filter(s => s.principale).map(s => s.id)).toEqual([s2.id])
    })

    it('non si disattiva la principale (409) ne una sede disattivata diventa principale', async () => {
      const t = await azienda()
      const r = await risolvi(t, 'PRODUTTORE', dati())
      await expect(
        nelTenant(t, () => service.aggiornaSede(r.dittaId, r.sedeId, { attiva: false }))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)
      const libera = await nelTenant(t, () =>
        service.aggiungiSede(r.dittaId, { indirizzo: { ...INDIRIZZO, civico: '2' } })
      )
      await nelTenant(t, () => service.aggiornaSede(r.dittaId, libera.id, { attiva: false }))
      await expect(
        nelTenant(t, () => service.impostaPrincipale(r.dittaId, libera.id))
      ).rejects.toBeInstanceOf(SedeNonModificabileError)
    })

    it('non si disattiva la sede predefinita di un ruolo (409)', async () => {
      const t = await azienda()
      const r = await risolvi(t, 'PRODUTTORE', dati())
      const altra = await nelTenant(t, () =>
        service.aggiungiSede(r.dittaId, { indirizzo: { ...INDIRIZZO, civico: '2' } })
      )
      // il "chiamante" (Task 3a) inserisce la riga di ruolo con la sede predefinita
      await owner.destinatario.create({
        data: {
          tenantId: t,
          numeroAutorizzazione: 'AUT-1',
          dittaId: r.dittaId,
          sedeId: altra.id,
        },
      })
      const p = nelTenant(t, () => service.aggiornaSede(r.dittaId, altra.id, { attiva: false }))
      await expect(p).rejects.toBeInstanceOf(SedeNonModificabileError)
      await p.catch(e => expect(e.message).toContain('predefinita del destinatario'))
      const dto = await nelTenant(t, () => service.dettaglio(r.dittaId))
      expect(dto.ruoli.destinatarioId).toBeDefined()
      expect(dto.sedi.find(s => s.id === altra.id)?.attiva).toBe(true)
    })
  })

  describe('isolamento fra aziende', () => {
    it('un altra azienda non trova la ditta, ne la cerca, ne la modifica', async () => {
      const a = await azienda()
      const b = await azienda()
      const r = await risolvi(a, 'PRODUTTORE', dati())
      expect(await nelTenant(b, () => service.cerca(PIVA_VALIDA))).toBeNull()
      await expect(nelTenant(b, () => service.dettaglio(r.dittaId))).rejects.toBeInstanceOf(
        DittaNonTrovataError
      )
      await expect(
        nelTenant(b, () => service.aggiornaDitta(r.dittaId, { ragioneSociale: 'Intrusa' }))
      ).rejects.toBeInstanceOf(DittaNonTrovataError)
      await expect(
        nelTenant(b, () => service.aggiornaSede(r.dittaId, r.sedeId, { referente: 'x' }))
      ).rejects.toBeInstanceOf(DittaNonTrovataError)
      // la stessa P.IVA in un'altra azienda e una ditta distinta
      const rb = await risolvi(b, 'PRODUTTORE', dati())
      expect(rb.dittaId).not.toBe(r.dittaId)
      expect((await dittePerTenant(a))[0].ragioneSociale).toBe('Rossi S.r.l.')
    })

    it('cerca restituisce ditta, sedi e ruoli della propria azienda', async () => {
      const t = await azienda()
      const r = await risolvi(t, 'PRODUTTORE', dati())
      const dto = await nelTenant(t, () => service.cerca(`IT${PIVA_VALIDA}`))
      expect(dto).toMatchObject({
        id: r.dittaId,
        partitaIva: PIVA_VALIDA,
        privato: false,
        partitaIvaDaVerificare: false,
      })
      expect(dto?.sedi).toHaveLength(1)
    })
  })
})
