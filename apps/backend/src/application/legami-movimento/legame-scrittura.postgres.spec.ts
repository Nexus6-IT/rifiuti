/**
 * Scrittura della proposta (fase 4.3, Task 15) contro un Postgres reale, collegato COME
 * `wasteflow_app`. `scriviProposta` è l'unico punto che scrive testata e righe; non tocca mai il
 * registro (`waste_movements`): lo verifica anche la guardia statica.
 */
import { ConflictException } from '@nestjs/common'
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
const NOME_APPLICAZIONE = `legami-t15s-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo } from '../../test-support/anagrafiche-di-test'
import {
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { scriviProposta } from './legame-scrittura'
import {
  PropostaLegameService,
  type InputProposta,
  type PropostaVista,
  type ScelteProposta,
} from './proposta-legame.service'

describe('scriviProposta — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: PropostaLegameService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new PropostaLegameService(app)
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  async function scenario(righeV = 1): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      righeV,
      onTenantCreato: id => tenantCreati.push(id),
    })
    await owner.impostazioneFatturazione.create({
      data: { tenantId: s.tenantId, fatturazioneDa: new Date('2026-01-01T00:00:00Z') },
    })
    return s
  }

  const input = (s: ScenarioProposta, o: Partial<InputProposta> = {}): InputProposta => ({
    causale: 'INGRESSO_ESTERNO',
    type: 'CARICO',
    cerCode: '20 03 01',
    movementDate: '2026-03-01',
    unit: 'KG',
    quantity: '100',
    firId: s.firId,
    ...o,
  })

  const proposta = (s: ScenarioProposta, o: Partial<InputProposta> = {}, sc?: ScelteProposta) =>
    nel(s.tenantId, () => service.calcola(s.tenantId, input(s, o), sc))

  const scrivi = (s: ScenarioProposta, p: PropostaVista, dataMovimento = '2026-03-01') =>
    nel(s.tenantId, () =>
      app.$transaction(tx =>
        scriviProposta(tx, {
          tenantId: s.tenantId,
          userId: s.utenteId,
          registroId: s.registroId,
          verso: 'CARICO',
          movimentoOriginaleId: s.movimentoId,
          movimentoVigenteId: s.movimentoId,
          dataMovimento,
          proposta: p,
        })
      )
    )

  it('crea la testata con movimento_originale_id = radice e righe con i valori calcolati e congelata_il NULL', async () => {
    const s = await scenario(1)
    const p = await proposta(s)
    const { legameId } = await scrivi(s, p)
    const l = await owner.legameMovimento.findUniqueOrThrow({
      where: { id: legameId },
      include: { righe: { orderBy: { ordine: 'asc' } } },
    })
    expect(l).toMatchObject({
      tenantId: s.tenantId,
      registroId: s.registroId,
      verso: 'CARICO',
      movimentoOriginaleId: s.movimentoId,
      movimentoVigenteId: s.movimentoId,
      stato: 'PROPOSTO',
      clienteId: s.clienteId,
      fonteCliente: 'FIR',
      contrattoId: s.contrattoId,
      elencoId: s.elencoId,
      motivi: [],
      avvisi: [],
      versione: 1,
      creatoDa: s.utenteId,
      confermatoIl: null,
    })
    expect(l.dataMovimento.toISOString().slice(0, 10)).toBe('2026-03-01')
    expect(l.righe).toHaveLength(2)
    expect(l.righe[0]).toMatchObject({
      rigaAddebitoId: s.rigaCerId,
      elencoId: s.elencoId,
      ordine: 1,
      origine: 'PRINCIPALE',
      tipo: 'CER',
      unitaMisura: 'KG',
      quantitaOrigine: 'DA_MOVIMENTO',
      prezzoSpeciale: false,
      prezzoManuale: false,
      sconto: null,
      codiceIvaId: s.ivaId,
      congelataIl: null,
    })
    expect(l.righe[0].quantita?.toFixed()).toBe('100')
    expect(l.righe[0].prezzo?.toFixed()).toBe('1')
    expect(l.righe[0].aliquotaIva.toFixed()).toBe('22')
    expect(l.righe[1]).toMatchObject({ origine: 'PROPOSTA', congelataIl: null })
  })

  it('scrive anche una proposta incompleta (DA_COLLEGARE con i motivi e gli avvisi)', async () => {
    const s = await scenario(1)
    const fir = await owner.fIR.findUniqueOrThrow({ where: { id: s.firId } })
    void fir
    const p = await proposta(s, { cerCode: '15 01 01' })
    const { legameId } = await scrivi(s, p)
    const l = await owner.legameMovimento.findUniqueOrThrow({ where: { id: legameId } })
    expect(l.stato).toBe('DA_COLLEGARE')
    expect(l.motivi).toContain('SENZA_RIGA_CER')
    expect(l.clienteId).toBe(s.clienteId)
  })

  it('due volte per la stessa radice: la seconda restituisce il legame esistente (nessun errore sull’unico)', async () => {
    const s = await scenario(1)
    const p = await proposta(s)
    const a = await scrivi(s, p)
    const b = await scrivi(s, p)
    expect(b.legameId).toBe(a.legameId)
    expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(1)
    expect(await owner.rigaLegameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(2)
  })

  it('la proposta virtuale ESCLUSO (fatturazione spenta o causale non fatturabile) non si scrive', async () => {
    const s = await scenario(1)
    const p = await proposta(s, { causale: 'PRODUZIONE_INTERNA' })
    expect(p.stato).toBe('ESCLUSO')
    await expect(scrivi(s, p)).rejects.toThrow(/non si scrive/)
    expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(0)
  })

  it('cliente eliminato fra la proposta e la scrittura (23503): 409, non un 500', async () => {
    const s = await scenario(0)
    const nudo = await creaDittaConRuolo(owner, s.tenantId, 'CLIENTE')
    // `creaDittaConRuolo(.., 'CLIENTE')` crea il cliente senza contratti: DA_COLLEGARE con cliente.
    const p = await proposta(s, { firId: null }, { clienteId: nudo.ruoloId })
    expect(p).toMatchObject({ stato: 'DA_COLLEGARE', motivi: ['SENZA_CONTRATTO'] })
    await owner.cliente.delete({ where: { id: nudo.ruoloId } })
    const esito = scrivi(s, p)
    await expect(esito).rejects.toBeInstanceOf(ConflictException)
    await expect(esito).rejects.toMatchObject({
      response: { error: 'OPERAZIONE_CONCORRENTE' },
    })
    expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(0)
  })

  it('nessuna scrittura sul registro: il movimento resta identico', async () => {
    const s = await scenario(1)
    const prima = await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })
    await scrivi(s, await proposta(s))
    expect(await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })).toEqual(
      prima
    )
  })

  describe('concorrenza sull’unico della catena (senza lock consultivo)', () => {
    const OPZ = { timeout: 60_000, maxWait: 30_000 }
    async function inAttesaDiLock(): Promise<number> {
      const r = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
          AND wait_event_type = 'Lock'`
      return r[0].n
    }
    async function attendiLock(finita: () => boolean): Promise<void> {
      const scadenza = Date.now() + 30_000
      for (;;) {
        if ((await inAttesaDiLock()) >= 1) return
        if (finita()) throw new Error('la transazione è finita senza attendere il lock')
        if (Date.now() > scadenza) throw new Error('nessuna sessione in attesa di lock')
        await new Promise(r => setTimeout(r, 20))
      }
    }

    /** A (proprietario) inserisce il legame e tiene la transazione aperta; B (servizio) scrive lo stesso. */
    async function provaConcorrenza(finaleDiA: 'commit' | 'rollback') {
      const s = await scenario(1)
      const p = await proposta(s)
      let rilascia!: () => void
      const gate = new Promise<void>(r => (rilascia = r))
      let tenuto!: () => void
      const preso = new Promise<void>(r => (tenuto = r))
      let idA = ''
      const a = owner
        .$transaction(async tx => {
          idA = (
            await scriviProposta(tx, {
              tenantId: s.tenantId,
              userId: s.utenteId,
              registroId: s.registroId,
              verso: 'CARICO',
              movimentoOriginaleId: s.movimentoId,
              movimentoVigenteId: s.movimentoId,
              dataMovimento: '2026-03-01',
              proposta: p,
            })
          ).legameId
          tenuto()
          await gate
          if (finaleDiA === 'rollback') throw new Error('rollback voluto')
        }, OPZ)
        .catch(e => {
          if (!(e instanceof Error) || e.message !== 'rollback voluto') throw e
        })
      await preso
      let finita = false
      const b = scrivi(s, p).finally(() => (finita = true))
      await attendiLock(() => finita)
      rilascia()
      await a
      const rb = await b
      return { s, idA, rb }
    }

    it('A non ha ancora fatto commit: B aspetta, poi restituisce il legame di A, senza errore e con una sola testata', async () => {
      const { s, idA, rb } = await provaConcorrenza('commit')
      expect(rb.legameId).toBe(idA)
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(1)
      expect(await owner.rigaLegameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(2)
    })

    it('A fa rollback: B inserisce la sua testata (id diverso), una sola', async () => {
      const { s, idA, rb } = await provaConcorrenza('rollback')
      expect(rb.legameId).not.toBe(idA)
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(1)
      expect(await owner.rigaLegameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(2)
    })
  })
})
