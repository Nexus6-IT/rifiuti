/**
 * Dati del cedente (4.4a, Task 7) contro un Postgres reale, collegato COME `wasteflow_app`, dentro
 * il `TenantContext`. Il proprietario prepara aziende e registri e legge lo stato finale. Pulizia
 * solo per id esatti creati.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
const NOME_APPLICAZIONE = `cedente-t7-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { CedenteService, type DatiCedente } from './cedente.service'

describe('CedenteService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: CedenteService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new CedenteService(app)
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(conSede = true) {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Cedente SRL',
        country: 'IT',
        ...(conSede
          ? { address: 'Via Roma', civico: '1', postalCode: '00100', city: 'Roma', province: 'RM' }
          : {}),
      },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-ced-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `ced-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const registro = await owner.registroIva.create({
      data: { tenantId: t.id, codice: '01', descrizione: 'Vendite' },
    })
    return { tenantId: t.id, utenteId: utente.id, registroId: registro.id }
  }

  const leggi = (t: string) => nel(t, () => service.leggi(t))
  const imposta = (t: string, u: string, dati: DatiCedente) =>
    nel(t, () => service.imposta(t, u, dati))
  const audit = (tenantId: string) =>
    owner.activityLog.findMany({
      where: { tenantId, action: 'CEDENTE_FATTURAZIONE_MODIFICATO' },
      orderBy: { createdAt: 'asc' },
    })

  it('GET senza riga: completo false, «Regime fiscale» mancante, versione 0', async () => {
    const { tenantId } = await azienda()
    const v = await leggi(tenantId)
    expect(v).toMatchObject({
      regimeFiscale: null,
      versione: 0,
      completo: false,
      statoLiquidazione: 'LN',
    })
    expect(v.mancanti).toContain('Regime fiscale')
    expect(v.daTenant).toMatchObject({ ragioneSociale: 'Cedente SRL', indirizzo: 'Via Roma 1' })
  })

  it('PUT prima volta (versione 0): versione 1, default LN, completo; poi si legge uguale', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      socioUnico: 'SU',
      versione: 0,
    })
    expect(r).toMatchObject({
      regimeFiscale: 'RF01',
      socioUnico: 'SU',
      statoLiquidazione: 'LN',
      versione: 1,
      completo: true,
      mancanti: [],
    })
    expect(await leggi(tenantId)).toEqual(r)
    const riga = await owner.cedenteFatturazione.findFirstOrThrow({ where: { tenantId } })
    expect(riga.modificatoDa).toBe(utenteId)
  })

  it('capitale sociale "1000.50" salvato e riletto come stringa', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      capitaleSociale: '1000.50',
      versione: 0,
    })
    expect(r.capitaleSociale).toBe('1000.50')
  })

  it('PUT con null cancella i campi facoltativi', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      reaUfficio: 'RM',
      capitaleSociale: '5000.00',
      socioUnico: 'SM',
      registroIvaPredefinitoId: registroId,
      idTrasmittenteCodice: 'ABC1234',
      versione: 0,
    })
    const r = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      reaUfficio: null,
      capitaleSociale: null,
      socioUnico: null,
      registroIvaPredefinitoId: null,
      idTrasmittenteCodice: null,
      versione: 1,
    })
    expect(r).toMatchObject({
      reaUfficio: null,
      capitaleSociale: null,
      socioUnico: null,
      registroIvaPredefinitoId: null,
      idTrasmittenteCodice: null,
      versione: 2,
    })
    const riga = await owner.cedenteFatturazione.findFirstOrThrow({ where: { tenantId } })
    expect(riga.capitaleSociale).toBeNull()
    expect(riga.registroIvaPredefinitoId).toBeNull()
  })

  it('registro predefinito di un altro tenant: 404, nulla scritto', async () => {
    const a = await azienda()
    const b = await azienda()
    const err: any = await imposta(a.tenantId, a.utenteId, {
      regimeFiscale: 'RF01',
      registroIvaPredefinitoId: b.registroId,
      versione: 0,
    }).catch(e => e)
    expect(err.getStatus()).toBe(404)
    expect(await owner.cedenteFatturazione.count({ where: { tenantId: a.tenantId } })).toBe(0)
  })

  it('registro disattivato: 400 se nuovo, ammesso se già salvato', async () => {
    const { tenantId, utenteId, registroId } = await azienda()
    await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      registroIvaPredefinitoId: registroId,
      versione: 0,
    })
    await owner.registroIva.update({ where: { id: registroId }, data: { attivo: false } })
    const r = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF02',
      registroIvaPredefinitoId: registroId,
      versione: 1,
    })
    expect(r.registroIvaPredefinitoId).toBe(registroId)
    const altro = await owner.registroIva.create({
      data: { tenantId, codice: '09', descrizione: 'Spento', attivo: false },
    })
    const err: any = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF02',
      registroIvaPredefinitoId: altro.id,
      versione: 2,
    }).catch(e => e)
    expect(err.getStatus()).toBe(400)
    expect(err.getResponse().error).toBe('REGISTRO_IVA_NON_ATTIVO')
  })

  it('audit: capitale sociale «10» registrato come «10.00»', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { regimeFiscale: 'RF01', capitaleSociale: '10', versione: 0 })
    const m = (await audit(tenantId))[0].metadata as any
    expect(m.capitaleSociale).toEqual({ prima: null, dopo: '10.00' })
  })

  it('capitale sociale con 11 cifre intere si salva', async () => {
    const { tenantId, utenteId } = await azienda()
    const r = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      capitaleSociale: '12345678901.99',
      versione: 0,
    })
    expect(r.capitaleSociale).toBe('12345678901.99')
  })

  it('tenant senza indirizzo: completo false con «Indirizzo della sede»', async () => {
    const { tenantId, utenteId } = await azienda(false)
    const r = await imposta(tenantId, utenteId, { regimeFiscale: 'RF01', versione: 0 })
    expect(r.completo).toBe(false)
    expect(r.mancanti).toEqual(['Indirizzo della sede'])
  })

  it('versione vecchia: 409 VERSIONE_SUPERATA', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { regimeFiscale: 'RF01', versione: 0 })
    const err: any = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF02',
      versione: 0,
    }).catch(e => e)
    expect(err.getStatus()).toBe(409)
    expect(err.getResponse().error).toBe('VERSIONE_SUPERATA')
    expect((await leggi(tenantId)).regimeFiscale).toBe('RF01')
  })

  it('PUT senza cambi: nessuna scrittura, nessun audit, versione invariata', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      capitaleSociale: '10.00',
      versione: 0,
    })
    const r = await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      capitaleSociale: '10',
      versione: 1,
    })
    expect(r.versione).toBe(1)
    expect(await audit(tenantId)).toHaveLength(1)
  })

  it('audit: nomi dei campi cambiati, codici e importi prima e dopo, nessun testo libero', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF01',
      capitaleSociale: '1000.00',
      versione: 0,
    })
    await imposta(tenantId, utenteId, {
      regimeFiscale: 'RF19',
      reaUfficio: 'ZQ',
      capitaleSociale: '2500.75',
      socioUnico: 'SU',
      statoLiquidazione: 'LS',
      idTrasmittenteCodice: 'TESTOLIBERO1',
      versione: 1,
    })
    const righe = await audit(tenantId)
    expect(righe).toHaveLength(2)
    const m = righe[1].metadata as any
    expect(m.campiCambiati.sort()).toEqual(
      [
        'capitaleSociale',
        'idTrasmittenteCodice',
        'reaUfficio',
        'regimeFiscale',
        'socioUnico',
        'statoLiquidazione',
      ].sort()
    )
    expect(m.regimeFiscale).toEqual({ prima: 'RF01', dopo: 'RF19' })
    expect(m.socioUnico).toEqual({ prima: null, dopo: 'SU' })
    expect(m.statoLiquidazione).toEqual({ prima: 'LN', dopo: 'LS' })
    expect(m.capitaleSociale).toEqual({ prima: '1000.00', dopo: '2500.75' })
    const testo = JSON.stringify(righe.map(r => [r.description, r.metadata]))
    expect(testo).not.toContain('ZQ')
    expect(testo).not.toContain('TESTOLIBERO1')
  })

  it('RLS: un altro tenant non vede la riga', async () => {
    const a = await azienda()
    const b = await azienda()
    await imposta(a.tenantId, a.utenteId, { regimeFiscale: 'RF01', versione: 0 })
    expect(await nel(b.tenantId, () => app.cedenteFatturazione.count())).toBe(0)
    expect(await leggi(b.tenantId)).toMatchObject({ regimeFiscale: null, versione: 0 })
  })

  it('due PUT concorrenti con la stessa versione: uno 200 e uno 409 (barriera su pg_stat_activity)', async () => {
    const { tenantId, utenteId } = await azienda()
    await imposta(tenantId, utenteId, { regimeFiscale: 'RF01', versione: 0 })

    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let tenuto!: () => void
    const eTenuto = new Promise<void>(r => (tenuto = r))
    const tenitore = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "cedente_fatturazione"
          WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
        tenuto()
        await barriera
      },
      { timeout: 60_000 }
    )
    await eTenuto

    const lancia = (regimeFiscale: string) =>
      imposta(tenantId, utenteId, { regimeFiscale, versione: 1 }).then(
        r => ({ r }),
        e => ({ e })
      )
    const primo = lancia('RF02')
    const secondo = lancia('RF04')
    const scadenza = Date.now() + 30_000
    for (;;) {
      const r = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
          AND wait_event_type = 'Lock'`
      if (r[0].n >= 2) break
      if (Date.now() > scadenza) throw new Error('le due sessioni non sono in attesa del lock')
      await new Promise(res => setTimeout(res, 25))
    }
    rilascia()
    await tenitore
    const esiti = await Promise.all([primo, secondo])
    const riusciti = esiti.filter(e => 'r' in e)
    const falliti = esiti.filter(e => 'e' in e) as { e: any }[]
    expect(riusciti).toHaveLength(1)
    expect(falliti).toHaveLength(1)
    expect(falliti[0].e.getStatus()).toBe(409)
    expect(falliti[0].e.getResponse().error).toBe('VERSIONE_SUPERATA')
    expect((await leggi(tenantId)).versione).toBe(2)
  })

  it('due prime impostazioni insieme (versione 0): una riesce, l’altra 409', async () => {
    const { tenantId, utenteId } = await azienda()
    const esiti = await Promise.all(
      ['RF01', 'RF02'].map(regimeFiscale =>
        imposta(tenantId, utenteId, { regimeFiscale, versione: 0 }).then(
          r => ({ r }),
          e => ({ e })
        )
      )
    )
    expect(esiti.filter(e => 'r' in e)).toHaveLength(1)
    const fallito = esiti.find(e => 'e' in e) as { e: any }
    expect(fallito.e.getStatus()).toBe(409)
    expect(await owner.cedenteFatturazione.count({ where: { tenantId } })).toBe(1)
  })
})
