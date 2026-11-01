/**
 * Agenti, clienti, contratti cliente, periodi e allegati (Fase 4 pezzo 1, migration
 * `20261102200100_clienti_agenti_contratti_cliente`) contro un Postgres reale, collegato COME
 * `wasteflow_app`, dentro il `TenantContext`: valori predefiniti, CHECK, unici, chiavi esterne
 * composite con `tenant_id`, RLS e cascata sul tenant. Il proprietario prepara i dati e prova le
 * violazioni che la RLS nasconderebbe. Pulizia solo per id esatti creati (la cascata sul tenant
 * svuota le tabelle: le chiavi `NO ACTION` si controllano a fine statement).
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

import { TenantContext } from '../../core/context/tenant-context'
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { creaTabelleFatturazione } from '../../test-support/fatturazione-di-test'

describe('Clienti, agenti e contratti cliente — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now() + ++n),
        ragioneSociale: 'Clienti schema SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const esito = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e: any) {
      return { code: e.code as string | undefined, msg: String(e.message) }
    }
    return null
  }

  /** Una ditta con la sua sede principale, senza ruoli. */
  async function ditta(tenantId: string) {
    const d = await owner.ditta.create({
      data: {
        tenantId,
        ragioneSociale: `Ditta ${++n}`,
        partitaIva: partitaIvaValida(Date.now() + ++n),
      },
    })
    const s = await owner.sedeDitta.create({
      data: {
        tenantId,
        dittaId: d.id,
        via: 'Via Roma',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
        principale: true,
      },
    })
    return { dittaId: d.id, sedeId: s.id }
  }

  async function cliente(tenantId: string, extra: Record<string, unknown> = {}) {
    const d = await ditta(tenantId)
    const c = await owner.cliente.create({ data: { tenantId, ...d, ...extra } })
    return { ...d, clienteId: c.id }
  }

  async function agente(tenantId: string, extra: Record<string, unknown> = {}) {
    const d = await ditta(tenantId)
    const a = await owner.agente.create({ data: { tenantId, ...d, ...extra } })
    return { ...d, agenteId: a.id }
  }

  let progressivo = 0
  const contratto = (tenantId: string, clienteId: string, extra: Record<string, unknown> = {}) => ({
    tenantId,
    clienteId,
    numero: `CC-2026-${String(++progressivo).padStart(3, '0')}`,
    descrizione: 'Contratto di prova',
    dataInizio: new Date('2026-01-01'),
    ...extra,
  })

  it('un contratto nuovo nasce in BOZZA, versione 1, rinnovo false, annotazioni vuote', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await nel(t, () => app.contrattoCliente.create({ data: contratto(t, clienteId) }))
    expect(c).toMatchObject({
      stato: 'BOZZA',
      versione: 1,
      rinnovoAutomatico: false,
      annotazioni: [],
      esigibilitaIva: 'IMMEDIATA',
      sogliaIvaEsclusa: false,
      incrementoIstat: false,
      escludiDichiarazioneIntento: false,
      eliminatoIl: null,
    })
  })

  it('due clienti per la stessa ditta: P2002 su clienti_tenant_id_ditta_id_key', async () => {
    const t = await azienda()
    const d = await ditta(t)
    await nel(t, () => app.cliente.create({ data: { tenantId: t, ...d, codice: 'A1' } }))
    const r = await esito(
      nel(t, () => app.cliente.create({ data: { tenantId: t, ...d, codice: 'A2' } }))
    )
    expect(r?.code).toBe('P2002')
    const indici = await owner.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'clienti' AND indexname = 'clienti_tenant_id_ditta_id_key'`
    expect(indici).toHaveLength(1)
  })

  it('due agenti per la stessa ditta: P2002 su agenti_tenant_id_ditta_id_key', async () => {
    const t = await azienda()
    const d = await ditta(t)
    await nel(t, () => app.agente.create({ data: { tenantId: t, ...d, codice: 'G1' } }))
    const r = await esito(
      nel(t, () => app.agente.create({ data: { tenantId: t, ...d, codice: 'G2' } }))
    )
    expect(r?.code).toBe('P2002')
    const indici = await owner.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'agenti' AND indexname = 'agenti_tenant_id_ditta_id_key'`
    expect(indici).toHaveLength(1)
  })

  it('stesso codice su due clienti (o due agenti): P2002', async () => {
    const t = await azienda()
    await cliente(t, { codice: 'DUP' })
    const d = await ditta(t)
    const r = await esito(
      nel(t, () => app.cliente.create({ data: { tenantId: t, ...d, codice: 'DUP' } }))
    )
    expect(r?.code).toBe('P2002')
    await agente(t, { codice: 'DUP' })
    const d2 = await ditta(t)
    const r2 = await esito(
      nel(t, () => app.agente.create({ data: { tenantId: t, ...d2, codice: 'DUP' } }))
    )
    expect(r2?.code).toBe('P2002')
  })

  it("FK composita: la sede di un'altra ditta è respinta (cliente e agente)", async () => {
    const t = await azienda()
    const a = await ditta(t)
    const b = await ditta(t)
    const rc = await esito(
      owner.cliente.create({ data: { tenantId: t, dittaId: a.dittaId, sedeId: b.sedeId } })
    )
    expect(rc?.msg).toContain('clienti_sede_fkey')
    const ra = await esito(
      owner.agente.create({ data: { tenantId: t, dittaId: a.dittaId, sedeId: b.sedeId } })
    )
    expect(ra?.msg).toContain('agenti_sede_fkey')
  })

  it('FK composita: cliente di un altro tenant respinto', async () => {
    const a = await azienda()
    const b = await azienda()
    const { clienteId } = await cliente(a)
    const r = await esito(owner.contrattoCliente.create({ data: contratto(b, clienteId) }))
    expect(r?.code).toBe('P2003')
    expect(r?.msg).toContain('contratti_cliente_cliente_fkey')
  })

  it('FK composita: conto corrente di un altro tenant respinto (contratto e cliente)', async () => {
    const a = await azienda()
    const b = await azienda()
    const { contoId } = await creaTabelleFatturazione(owner, a)
    const { clienteId } = await cliente(b)
    const r = await esito(
      owner.contrattoCliente.create({ data: contratto(b, clienteId, { contoCorrenteId: contoId }) })
    )
    expect(r?.msg).toContain('contratti_cliente_conto_corrente_fkey')
    const d = await ditta(b)
    const rc = await esito(
      owner.cliente.create({ data: { tenantId: b, ...d, contoCorrenteId: contoId } })
    )
    expect(rc?.msg).toContain('clienti_conto_corrente_fkey')
  })

  it('FK composita: codifica di un altro tenant respinta', async () => {
    const a = await azienda()
    const b = await azienda()
    const { categoriaId } = await creaTabelleFatturazione(owner, a)
    const { clienteId } = await cliente(b)
    const r = await esito(
      owner.contrattoCliente.create({ data: contratto(b, clienteId, { categoriaId }) })
    )
    expect(r?.msg).toContain('contratti_cliente_categoria_fkey')
  })

  it('FK composita: agente di un altro tenant respinto sul cliente', async () => {
    const a = await azienda()
    const b = await azienda()
    const { agenteId } = await agente(a)
    const d = await ditta(b)
    const r = await esito(owner.cliente.create({ data: { tenantId: b, ...d, agenteId } }))
    expect(r?.msg).toContain('clienti_agente_fkey')
  })

  it('riferimenti validi: bollo e spese di incasso distinti, contratto principale e allegato', async () => {
    const t = await azienda()
    const f = await creaTabelleFatturazione(owner, t)
    const { agenteId } = await agente(t)
    const { clienteId } = await cliente(t, {
      speseIncassoId: f.speseId,
      bolloId: f.bolloId,
      condizionePagamentoId: f.condizioneId,
      registroIvaId: f.registroId,
      contoCorrenteId: f.contoId,
      agenteId,
      ritenutaPercentuale: '20.00',
    })
    const principale = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    const allegato = await owner.contrattoCliente.create({
      data: contratto(t, clienteId, {
        contrattoPrincipaleId: principale.id,
        categoriaId: f.categoriaId,
        tipoId: f.tipoId,
        testoFatturazioneId: f.testoId,
        agenteId,
        speseIncassoId: f.speseId,
        bolloId: f.bolloId,
      }),
    })
    expect(allegato.contrattoPrincipaleId).toBe(principale.id)
  })

  it('stato ANNULLATO senza motivo respinto', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({ data: contratto(t, clienteId, { stato: 'ANNULLATO' }) })
    )
    expect(r?.msg).toContain('contratti_cliente_annullo_coerente')
    await owner.contrattoCliente.create({
      data: contratto(t, clienteId, {
        stato: 'ANNULLATO',
        motivoAnnullo: 'Recesso',
        annullatoIl: new Date(),
      }),
    })
  })

  it("fine prima dell'inizio respinta", async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { dataFine: new Date('2025-12-31') }),
      })
    )
    expect(r?.msg).toContain('contratti_cliente_date_coerenti')
  })

  it('contratto allegato a sé respinto', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    const r = await esito(
      owner.contrattoCliente.update({
        where: { id: c.id },
        data: { contrattoPrincipaleId: c.id },
      })
    )
    expect(r?.msg).toContain('contratti_cliente_non_allegato_a_se')
  })

  it('soglia_dal senza soglia respinta', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { sogliaDal: new Date('2026-02-01') }),
      })
    )
    expect(r?.msg).toContain('contratti_cliente_soglia_coerente')
    const r0 = await esito(
      owner.contrattoCliente.create({ data: contratto(t, clienteId, { sogliaImporto: '0.00' }) })
    )
    expect(r0?.msg).toContain('contratti_cliente_soglia_coerente')
  })

  it('validità con la sola quantità respinta', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({ data: contratto(t, clienteId, { validitaQuantita: 3 }) })
    )
    expect(r?.msg).toContain('contratti_cliente_validita_coerente')
    const r2 = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { validitaQuantita: 3, validitaUnita: 'X' }),
      })
    )
    expect(r2?.msg).toContain('contratti_cliente_validita_coerente')
    await owner.contrattoCliente.create({
      data: contratto(t, clienteId, { validitaQuantita: 3, validitaUnita: 'M' }),
    })
  })

  it('codice rinnovo X respinto', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({ data: contratto(t, clienteId, { codiceRinnovo: 'X' }) })
    )
    expect(r?.msg).toContain('contratti_cliente_codice_rinnovo_ammesso')
  })

  it('4 annotazioni respinte', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { annotazioni: ['a', 'b', 'c', 'd'] }),
      })
    )
    expect(r?.msg).toContain('contratti_cliente_annotazioni_ammesse')
    await owner.contrattoCliente.create({
      data: contratto(t, clienteId, { annotazioni: ['a', 'b', 'c'] }),
    })
  })

  it('eliminato_da senza eliminato_il respinto', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { eliminatoDa: '00000000-0000-4000-8000-000000000001' }),
      })
    )
    expect(r?.msg).toContain('contratti_cliente_eliminazione_coerente')
  })

  it('ritenuta 31 respinta (cliente e contratto)', async () => {
    const t = await azienda()
    const d = await ditta(t)
    const rc = await esito(
      owner.cliente.create({ data: { tenantId: t, ...d, ritenutaPercentuale: '31.00' } })
    )
    expect(rc?.msg).toContain('clienti_ritenuta_ammessa')
    const { clienteId } = await cliente(t)
    const r = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { ritenutaPercentuale: '31.00' }),
      })
    )
    expect(r?.msg).toContain('contratti_cliente_ritenuta_ammessa')
    const r0 = await esito(
      owner.contrattoCliente.create({
        data: contratto(t, clienteId, { ritenutaPercentuale: '0.00' }),
      })
    )
    expect(r0?.msg).toContain('contratti_cliente_ritenuta_ammessa')
  })

  it('versione 0 respinta su agenti, clienti e contratti', async () => {
    const t = await azienda()
    const d = await ditta(t)
    expect(
      (await esito(owner.cliente.create({ data: { tenantId: t, ...d, versione: 0 } })))?.msg
    ).toContain('clienti_versione_positiva')
    const d2 = await ditta(t)
    expect(
      (await esito(owner.agente.create({ data: { tenantId: t, ...d2, versione: 0 } })))?.msg
    ).toContain('agenti_versione_positiva')
    const { clienteId } = await cliente(t)
    expect(
      (
        await esito(
          owner.contrattoCliente.create({ data: contratto(t, clienteId, { versione: 0 }) })
        )
      )?.msg
    ).toContain('contratti_cliente_versione_positiva')
  })

  it('due contratti con lo stesso numero: P2002', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    await owner.contrattoCliente.create({ data: contratto(t, clienteId, { numero: 'N-1' }) })
    const r = await esito(
      owner.contrattoCliente.create({ data: contratto(t, clienteId, { numero: 'N-1' }) })
    )
    expect(r?.code).toBe('P2002')
  })

  const periodo = (t: string, contrattoId: string, extra: Record<string, unknown> = {}) => ({
    tenantId: t,
    contrattoId,
    ordine: 1,
    giornoInizio: 1,
    meseInizio: 1,
    giornoFine: 31,
    meseFine: 3,
    ...extra,
  })

  it('periodo con ordine 13 respinto', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    const r = await esito(
      nel(t, () =>
        app.periodoFatturazioneCliente.create({ data: periodo(t, c.id, { ordine: 13 }) })
      )
    )
    expect(r?.msg).toContain('periodi_fatturazione_cliente_valori')
    const rg = await esito(
      owner.periodoFatturazioneCliente.create({ data: periodo(t, c.id, { meseFine: 13 }) })
    )
    expect(rg?.msg).toContain('periodi_fatturazione_cliente_valori')
  })

  it('due periodi con lo stesso ordine respinti', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    await nel(t, () => app.periodoFatturazioneCliente.create({ data: periodo(t, c.id) }))
    const r = await esito(
      nel(t, () => app.periodoFatturazioneCliente.create({ data: periodo(t, c.id) }))
    )
    expect(r?.code).toBe('P2002')
  })

  const allegato = (t: string, contrattoId: string, extra: Record<string, unknown> = {}) => ({
    tenantId: t,
    contrattoId,
    posizione: 1,
    nomeFile: 'contratto.pdf',
    mimeType: 'application/pdf',
    dimensioneByte: 4,
    sha256: 'a'.repeat(64),
    contenuto: Buffer.from('%PDF'),
    caricatoDa: '00000000-0000-4000-8000-000000000001',
    ...extra,
  })

  it('allegato in posizione 3 respinto', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    const r = await esito(
      nel(t, () =>
        app.allegatoContrattoCliente.create({ data: allegato(t, c.id, { posizione: 3 }) })
      )
    )
    expect(r?.msg).toContain('allegati_contratto_cliente_valori')
  })

  it('due allegati nella stessa posizione: P2002', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    await nel(t, () => app.allegatoContrattoCliente.create({ data: allegato(t, c.id) }))
    const r = await esito(
      nel(t, () => app.allegatoContrattoCliente.create({ data: allegato(t, c.id) }))
    )
    expect(r?.code).toBe('P2002')
  })

  it('mime image/png e dimensione oltre 4 MiB respinti', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    const r = await esito(
      owner.allegatoContrattoCliente.create({ data: allegato(t, c.id, { mimeType: 'image/png' }) })
    )
    expect(r?.msg).toContain('allegati_contratto_cliente_valori')
    const r2 = await esito(
      owner.allegatoContrattoCliente.create({
        data: allegato(t, c.id, { dimensioneByte: 4194305 }),
      })
    )
    expect(r2?.msg).toContain('allegati_contratto_cliente_valori')
  })

  it('cancellare un contratto (owner) cancella periodi e allegati', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    const c = await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    await owner.periodoFatturazioneCliente.create({ data: periodo(t, c.id) })
    await owner.allegatoContrattoCliente.create({ data: allegato(t, c.id) })
    await owner.contrattoCliente.delete({ where: { id: c.id } })
    expect(await owner.periodoFatturazioneCliente.count({ where: { contrattoId: c.id } })).toBe(0)
    expect(await owner.allegatoContrattoCliente.count({ where: { contrattoId: c.id } })).toBe(0)
  })

  it('eliminare un cliente citato da un contratto: errore FK (P2003)', async () => {
    const t = await azienda()
    const { clienteId } = await cliente(t)
    await owner.contrattoCliente.create({ data: contratto(t, clienteId) })
    const r = await esito(owner.cliente.delete({ where: { id: clienteId } }))
    expect(r?.code).toBe('P2003')
  })

  it('eliminare un cliente citato solo come cliente di fatturazione: errore FK', async () => {
    const t = await azienda()
    const principale = await cliente(t)
    const fatturazione = await cliente(t)
    await owner.contrattoCliente.create({
      data: contratto(t, principale.clienteId, { clienteFatturazioneId: fatturazione.clienteId }),
    })
    const r = await esito(owner.cliente.delete({ where: { id: fatturazione.clienteId } }))
    expect(r?.code).toBe('P2003')
  })

  it('eliminare una spesa citata da un cliente: errore FK; un agente citato: errore FK', async () => {
    const t = await azienda()
    const f = await creaTabelleFatturazione(owner, t)
    const { agenteId } = await agente(t)
    await cliente(t, { bolloId: f.bolloId, agenteId })
    const r = await esito(owner.spesaAccessoria.delete({ where: { id: f.bolloId } }))
    expect(r?.code).toBe('P2003')
    const ra = await esito(owner.agente.delete({ where: { id: agenteId } }))
    expect(ra?.code).toBe('P2003')
  })

  async function popola(t: string) {
    const f = await creaTabelleFatturazione(owner, t)
    const a = await agente(t)
    const c = await cliente(t, { agenteId: a.agenteId, condizionePagamentoId: f.condizioneId })
    const k = await owner.contrattoCliente.create({
      data: contratto(t, c.clienteId, { categoriaId: f.categoriaId, agenteId: a.agenteId }),
    })
    await owner.periodoFatturazioneCliente.create({ data: periodo(t, k.id) })
    await owner.allegatoContrattoCliente.create({ data: allegato(t, k.id) })
    return { ...c, contrattoId: k.id }
  }

  it('nel contesto di B le cinque tabelle di A sono vuote e un insert con tenant di A è respinto', async () => {
    const a = await azienda()
    const b = await azienda()
    const { dittaId, sedeId } = await popola(a)
    const conteggi = await nel(b, async () => [
      await app.agente.count(),
      await app.cliente.count(),
      await app.contrattoCliente.count(),
      await app.periodoFatturazioneCliente.count(),
      await app.allegatoContrattoCliente.count(),
    ])
    expect(conteggi).toEqual([0, 0, 0, 0, 0])
    const r = await esito(
      nel(b, () => app.agente.create({ data: { tenantId: a, dittaId, sedeId, codice: 'X' } }))
    )
    expect(r).not.toBeNull()
    expect(r?.msg).toMatch(/row-level security/i)
  })

  it('cancellare il tenant cancella tutto, tabelle del Task 8 comprese', async () => {
    const t = await azienda()
    await popola(t)
    await owner.tenant.deleteMany({ where: { id: { in: [t] } } })
    tenantCreati.splice(tenantCreati.indexOf(t), 1)
    const where = { tenantId: { in: [t] } }
    expect(
      await Promise.all([
        owner.agente.count({ where }),
        owner.cliente.count({ where }),
        owner.contrattoCliente.count({ where }),
        owner.periodoFatturazioneCliente.count({ where }),
        owner.allegatoContrattoCliente.count({ where }),
        owner.condizionePagamento.count({ where }),
        owner.contoCorrente.count({ where }),
        owner.spesaAccessoria.count({ where }),
        owner.registroIva.count({ where }),
        owner.testoFatturazione.count({ where }),
        owner.codificaContratto.count({ where }),
        owner.ditta.count({ where }),
      ])
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('ruoliDellaDitta riporta cliente e agente con la loro sede', async () => {
    const t = await azienda()
    const c = await cliente(t)
    const a = await agente(t)
    const repo = new DittaPrismaRepository()
    const ruoliCliente = await nel(t, () =>
      app.$transaction(async tx => await repo.ruoliDellaDitta(tx, c.dittaId))
    )
    expect(ruoliCliente).toEqual([{ ruolo: 'CLIENTE', id: c.clienteId, sedeId: c.sedeId }])
    const ruoliAgente = await nel(t, () =>
      app.$transaction(async tx => await repo.ruoliDellaDitta(tx, a.dittaId))
    )
    expect(ruoliAgente).toEqual([{ ruolo: 'AGENTE', id: a.agenteId, sedeId: a.sedeId }])
  })
})
