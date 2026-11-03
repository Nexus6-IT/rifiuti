/**
 * Proposta del legame (fase 4.3, Task 15) contro un Postgres reale, collegato COME
 * `wasteflow_app` dentro il `TenantContext`. Il proprietario prepara lo scenario
 * (`creaScenarioProposta`) e legge lo stato finale. Pulizia solo per id esatti. Le barriere
 * guardano `pg_stat_activity` (sessioni di QUESTO processo, `wait_event_type = 'Lock'`): niente
 * `sleep` come sincronizzazione.
 */
import { randomUUID } from 'node:crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
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
const NOME_APPLICAZIONE = `legami-t15-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo } from '../../test-support/anagrafiche-di-test'
import {
  creaFirDiTest,
  creaScenarioProposta,
  pulisciLegamiDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import { leggiFatturazioneDaInTx } from './impostazioni-fatturazione.service'
import {
  PropostaLegameService,
  type InputProposta,
  type ScelteProposta,
} from './proposta-legame.service'

describe('PropostaLegameService — Postgres reale, ruolo wasteflow_app', () => {
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
    if (tenantCreati.length > 0) {
      await pulisciLegamiDiTest(owner, tenantCreati)
      await owner.impostazioneFatturazione.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      for (const tabella of [
        'righe_addebito',
        'elenchi_addebiti',
        'contratti_cliente',
        'addebiti',
        'codifiche_addebito',
        'codici_iva',
      ]) {
        await owner.$executeRawUnsafe(
          `DELETE FROM ${tabella} WHERE tenant_id = ANY($1::uuid[])`,
          tenantCreati
        )
      }
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  /** Scenario con «fatturazione da» impostata al 1 gennaio 2026 (a meno di `da: null`). */
  async function scenario(righeV = 1, da: string | null = '2026-01-01'): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, { righeV })
    tenantCreati.push(s.tenantId)
    if (da !== null) {
      await owner.impostazioneFatturazione.create({
        data: { tenantId: s.tenantId, fatturazioneDa: new Date(`${da}T00:00:00Z`) },
      })
    }
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

  const calcola = (s: ScenarioProposta, o: Partial<InputProposta> = {}, sc?: ScelteProposta) =>
    nel(s.tenantId, () => service.calcola(s.tenantId, input(s, o), sc))

  async function legamiDi(tenantId: string): Promise<number> {
    return owner.legameMovimento.count({ where: { tenantId } })
  }

  describe('quando una proposta ha senso (spec §6.1)', () => {
    it('fatturazione spenta (nessuna riga di impostazione): attiva false, niente scritto', async () => {
      const s = await scenario(1, null)
      const p = await calcola(s)
      expect(p).toMatchObject({ fatturabile: true, attiva: false, stato: 'ESCLUSO', righe: [] })
      expect(p.cliente).toBeNull()
      expect(await legamiDi(s.tenantId)).toBe(0)
    })

    it('movimento prima di «fatturazione da»: attiva false', async () => {
      const s = await scenario(1, '2026-04-01')
      expect(await calcola(s)).toMatchObject({ attiva: false, stato: 'ESCLUSO' })
      // Il giorno di partenza compreso, il precedente escluso: il confronto è sul giorno italiano.
      expect(await calcola(s, { movementDate: '2026-04-01' })).toMatchObject({ attiva: true })
      expect(await calcola(s, { movementDate: '2026-03-31T22:30:00.000Z' })).toMatchObject({
        attiva: true,
      }) // 00:30 del 1 aprile a Roma (ora legale)
      expect(await calcola(s, { movementDate: '2026-03-31T21:30:00.000Z' })).toMatchObject({
        attiva: false,
      }) // 23:30 del 31 marzo a Roma
    })

    it('causale non fatturabile: fatturabile false', async () => {
      const s = await scenario()
      const p = await calcola(s, { causale: 'PRODUZIONE_INTERNA' })
      expect(p).toMatchObject({ fatturabile: false, attiva: true, stato: 'ESCLUSO', righe: [] })
    })

    it('causale sconosciuta: non fatturabile (nessuna eccezione)', async () => {
      const s = await scenario()
      expect(await calcola(s, { causale: 'NON_ESISTE' })).toMatchObject({ fatturabile: false })
    })
  })

  describe('proposta completa', () => {
    it('FIR con produttore cliente + un contratto ATTIVO + un elenco + riga CER vuota + una riga V: PROPOSTO, 2 righe, fonte FIR', async () => {
      const s = await scenario(1)
      const p = await calcola(s)
      expect(p).toMatchObject({
        fatturabile: true,
        attiva: true,
        stato: 'PROPOSTO',
        dettaglioCliente: null,
        motivi: [],
        avvisi: [],
      })
      expect(p.cliente).toMatchObject({ id: s.clienteId, fonte: 'FIR' })
      expect(p.cliente?.etichetta).toMatch(/^Ditta di test/)
      expect(p.contratto?.id).toBe(s.contrattoId)
      expect(p.contratto?.etichetta).toMatch(/^LST-2026-/)
      expect(p.elenco?.id).toBe(s.elencoId)
      expect(p.elenco?.etichetta).toBe('001 - Elenco di prova')
      expect(p.righe).toHaveLength(2)
      expect(p.righe[0]).toMatchObject({
        rigaAddebitoId: s.rigaCerId,
        ordine: 1,
        origine: 'PRINCIPALE',
        tipo: 'CER',
        unitaMisura: 'KG',
        quantita: '100',
        quantitaOrigine: 'DA_MOVIMENTO',
        prezzoSpeciale: false,
        prezzo: '1',
        sconto: null,
        prezzoManuale: false,
        aliquotaIva: '22',
        naturaIva: null,
        congelataIl: null,
        importo: '100.00',
      })
      expect(p.righe[1]).toMatchObject({
        rigaAddebitoId: s.righeVIds[0],
        ordine: 2,
        origine: 'PROPOSTA',
        tipo: 'V',
      })
      expect(p.candidati.contratti.map(c => c.id)).toEqual([s.contrattoId])
      expect(p.candidati.elenchi.map(e => e.id)).toEqual([s.elencoId])
      expect(p.candidati.righe.map(r => [r.id, r.origine])).toEqual([
        [s.rigaCerId, 'PRINCIPALE'],
        [s.righeVIds[0], 'PROPOSTA'],
      ])
    })

    it('è sola lettura: nessuna riga scritta', async () => {
      const s = await scenario(2)
      await calcola(s)
      expect(await legamiDi(s.tenantId)).toBe(0)
      expect(await owner.rigaLegameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(0)
    })
  })

  describe('cliente (§6.2, decisioni 1 e 19)', () => {
    it('senza FIR: SENZA_CLIENTE, DA_COLLEGARE, nessun avviso', async () => {
      const s = await scenario()
      const p = await calcola(s, { firId: null })
      expect(p).toMatchObject({
        stato: 'DA_COLLEGARE',
        cliente: null,
        motivi: ['SENZA_CLIENTE'],
        avvisi: [],
        contratto: null,
        righe: [],
      })
    })

    it('FIR che non porta a un cliente: SENZA_CLIENTE e avviso CLIENTE_NON_DA_FIR', async () => {
      const s = await scenario()
      const fir = await creaFirDiTest(owner, s.tenantId, s.utenteId)
      const p = await calcola(s, { firId: fir.id })
      expect(p).toMatchObject({
        stato: 'DA_COLLEGARE',
        motivi: ['SENZA_CLIENTE'],
        avvisi: ['CLIENTE_NON_DA_FIR'],
      })
    })

    it('cliente del FIR disattivato: SENZA_CLIENTE con dettaglioCliente «cliente disattivato», senza avviso', async () => {
      const s = await scenario()
      await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
      const p = await calcola(s)
      expect(p).toMatchObject({
        stato: 'DA_COLLEGARE',
        cliente: null,
        dettaglioCliente: 'cliente disattivato',
        motivi: ['SENZA_CLIENTE'],
        avvisi: [],
      })
    })

    it('scelte.clienteId dell’utente: fonte UTENTE, e la proposta segue il suo contratto', async () => {
      const s = await scenario()
      const altro = await creaContrattoConElenco(owner, s.tenantId)
      await creaRiga(owner, s.tenantId, altro.elencoId, {
        tipo: 'CER',
        cerCode: '20 03 01',
        codiceIvaId: s.ivaId,
        prezzo: '3',
      })
      const p = await calcola(s, { firId: null }, { clienteId: altro.clienteId })
      expect(p.cliente).toMatchObject({ id: altro.clienteId, fonte: 'UTENTE' })
      expect(p).toMatchObject({ stato: 'PROPOSTO', motivi: [] })
      expect(p.contratto?.id).toBe(altro.contrattoId)
      expect(p.righe[0]).toMatchObject({ origine: 'PRINCIPALE', prezzo: '3' })
    })

    it('cliente scelto inesistente (o di un altro tenant): 404; disattivato: 400', async () => {
      const s = await scenario()
      const altra = await scenario()
      await expect(calcola(s, {}, { clienteId: randomUUID() })).rejects.toBeInstanceOf(
        NotFoundException
      )
      await expect(calcola(s, {}, { clienteId: altra.clienteId })).rejects.toBeInstanceOf(
        NotFoundException
      )
      await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
      await expect(calcola(s, {}, { clienteId: s.clienteId })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('contratto, elenco o righe scelti senza un cliente: 400', async () => {
      const s = await scenario()
      await expect(
        calcola(s, { firId: null }, { contrattoId: s.contrattoId })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('contratto (§6.3, decisione 10)', () => {
    it('contratti con eliminatoIl valorizzato esclusi (M4): SENZA_CONTRATTO', async () => {
      const s = await scenario()
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { eliminatoIl: new Date(), eliminatoDa: s.utenteId },
      })
      const p = await calcola(s)
      expect(p).toMatchObject({
        stato: 'DA_COLLEGARE',
        motivi: ['SENZA_CONTRATTO'],
        contratto: null,
        elenco: null,
        righe: [],
      })
      expect(p.candidati.contratti).toEqual([])
    })

    it('candidati con sede diversa: SEDE_SENZA_CONTRATTO, e i contratti di altre sedi restano nel menu', async () => {
      const s = await scenario()
      const altraSede = (await creaDittaConRuolo(owner, s.tenantId, 'PRODUTTORE')).sedeId
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { sedeId: altraSede },
      })
      const p = await calcola(s)
      expect(p).toMatchObject({ stato: 'DA_COLLEGARE', motivi: ['SEDE_SENZA_CONTRATTO'] })
      expect(p.contratto).toBeNull()
      expect(p.candidati.contratti.map(c => c.id)).toEqual([s.contrattoId])
    })

    it('contratto di un’altra sede scelto a mano: lecito, avviso CONTRATTO_ALTRA_SEDE', async () => {
      const s = await scenario()
      const altraSede = (await creaDittaConRuolo(owner, s.tenantId, 'PRODUTTORE')).sedeId
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { sedeId: altraSede },
      })
      const p = await calcola(s, {}, { contrattoId: s.contrattoId })
      expect(p).toMatchObject({ stato: 'PROPOSTO', motivi: [], avvisi: ['CONTRATTO_ALTRA_SEDE'] })
      expect(p.contratto?.id).toBe(s.contrattoId)
    })

    it('contratto scelto non attivo alla data: CONTRATTO_NON_ATTIVO (la conferma lo rifiuterà con 409)', async () => {
      const s = await scenario()
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'SOSPESO' },
      })
      const p = await calcola(s, {}, { contrattoId: s.contrattoId })
      expect(p.motivi).toEqual(['CONTRATTO_NON_ATTIVO'])
      expect(p.stato).toBe('DA_COLLEGARE')
    })

    it('movimento retrodatato prima di dataInizio del contratto: CONTRATTO_NON_ATTIVO, mai un’eccezione', async () => {
      const s = await scenario()
      const p = await calcola(s, { movementDate: '2025-12-31' }, undefined)
      // «fatturazione da» è 2026-01-01: la proposta non c'è proprio.
      expect(p.attiva).toBe(false)
      await owner.impostazioneFatturazione.update({
        where: { tenantId: s.tenantId },
        data: { fatturazioneDa: new Date('2025-01-01T00:00:00Z') },
      })
      const q = await calcola(s, { movementDate: '2025-12-31' })
      expect(q.motivi).toEqual(['CONTRATTO_NON_ATTIVO'])
    })

    it('contratto di un altro cliente tra le scelte: 400', async () => {
      const s = await scenario()
      const altro = await creaContrattoConElenco(owner, s.tenantId)
      await expect(calcola(s, {}, { contrattoId: altro.contrattoId })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('contratto di un altro tenant (o inesistente): 404', async () => {
      const s = await scenario()
      const altra = await scenario()
      await expect(calcola(s, {}, { contrattoId: altra.contrattoId })).rejects.toBeInstanceOf(
        NotFoundException
      )
      await expect(calcola(s, {}, { contrattoId: randomUUID() })).rejects.toBeInstanceOf(
        NotFoundException
      )
    })
  })

  describe('elenco e righe (§6.3)', () => {
    it('elenco di un altro contratto: 400', async () => {
      const s = await scenario()
      const altroContratto = await creaContrattoConElenco(owner, s.tenantId, {
        clienteId: s.clienteId,
      })
      await expect(
        calcola(s, {}, { contrattoId: s.contrattoId, elencoId: altroContratto.elencoId })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('solo l’elenco scelto: il contratto è quello dell’elenco (se è del cliente), altrimenti 400', async () => {
      const s = await scenario()
      const secondo = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
      const p = await calcola(s, {}, { elencoId: secondo.elencoId })
      expect(p.contratto?.id).toBe(secondo.contrattoId)
      expect(p.elenco?.id).toBe(secondo.elencoId)
      expect(p.motivi).toEqual(['SENZA_RIGA_CER'])
      const estraneo = await creaContrattoConElenco(owner, s.tenantId)
      await expect(calcola(s, {}, { elencoId: estraneo.elencoId })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('righe di un altro elenco: 400; riga inesistente: 404', async () => {
      const s = await scenario()
      const altroElenco = await creaContrattoConElenco(owner, s.tenantId, {
        clienteId: s.clienteId,
        stato: 'ATTIVO',
      })
      const estranea = await creaRiga(owner, s.tenantId, altroElenco.elencoId, {
        codiceIvaId: s.ivaId,
      })
      await expect(
        calcola(s, {}, { contrattoId: s.contrattoId, righeIds: [estranea.id] })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        calcola(s, {}, { contrattoId: s.contrattoId, righeIds: [randomUUID()] })
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    it('elenco scaduto prima della data: ELENCO_SCADUTO', async () => {
      const s = await scenario()
      await owner.elencoAddebiti.update({
        where: { id: s.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-02-01T00:00:00Z'),
        },
      })
      const p = await calcola(s)
      expect(p.motivi).toEqual(['ELENCO_SCADUTO'])
      expect(p.elenco).toBeNull()
      expect(p.righe).toEqual([])
    })

    it('senza riga CER: SENZA_RIGA_CER, e le righe V proposte restano visibili', async () => {
      const s = await scenario(1)
      const p = await calcola(s, { cerCode: '15 01 01' })
      expect(p.motivi).toContain('SENZA_RIGA_CER')
      expect(p.stato).toBe('DA_COLLEGARE')
    })

    it('più righe CER con riferimento specifico: RIGA_AMBIGUA, la scelta dell’utente la risolve', async () => {
      const s = await scenario(0)
      await owner.rigaAddebito.delete({ where: { id: s.rigaCerId } })
      const a = await creaRiga(owner, s.tenantId, s.elencoId, {
        tipo: 'CER',
        cerCode: '20 03 01',
        riferimento: 'R1',
        codiceIvaId: s.ivaId,
      })
      await creaRiga(owner, s.tenantId, s.elencoId, {
        tipo: 'CER',
        cerCode: '20 03 01',
        riferimento: 'R2',
        codiceIvaId: s.ivaId,
      })
      const p = await calcola(s)
      expect(p.motivi).toEqual(['RIGA_AMBIGUA'])
      expect(p.candidati.righe.filter(r => r.origine === 'PRINCIPALE')).toHaveLength(2)
      const q = await calcola(s, {}, { righeIds: [a.id] })
      expect(q).toMatchObject({ stato: 'PROPOSTO', motivi: [] })
      expect(q.righe.map(r => [r.rigaAddebitoId, r.origine])).toEqual([[a.id, 'PRINCIPALE']])
    })

    it('una riga V aggiunta a mano ha origine MANUALE; le proposte non scelte spariscono', async () => {
      const s = await scenario(1)
      const v2 = await creaRiga(owner, s.tenantId, s.elencoId, { codiceIvaId: s.ivaId })
      const p = await calcola(s, {}, { righeIds: [s.rigaCerId, v2.id] })
      expect(p.righe.map(r => [r.rigaAddebitoId, r.origine])).toEqual([
        [s.rigaCerId, 'PRINCIPALE'],
        [v2.id, 'MANUALE'],
      ])
      expect(p.candidati.righe.map(r => r.id)).toContain(s.righeVIds[0])
    })
  })

  describe('quantità e prezzo (§6.4, §6.5)', () => {
    it('6000 KG con riga PESO_NETTO KG: "6000" (passa toFixed, mai la notazione esponenziale)', async () => {
      const s = await scenario(0)
      const p = await calcola(s, { quantity: '6000' })
      expect(p.righe[0]).toMatchObject({ quantita: '6000', importo: '6000.00' })
      const q = await calcola(s, { quantity: new Prisma.Decimal('1e-7').toFixed() })
      expect(q.righe[0].quantita).toBeNull() // arrotondata a 3 decimali: zero, quindi SENZA_QUANTITA
      expect(q.motivi).toEqual(['SENZA_QUANTITA'])
    })

    it('quantità oltre 3 decimali: arrotondata (decisione 18)', async () => {
      const s = await scenario(0)
      const p = await calcola(s, { quantity: '0.0005', unit: 'KG' })
      // PESO_NETTO in KG: 0.0005 → 0.001 (mezzo per eccesso)
      expect(p.righe[0].quantita).toBe('0.001')
    })

    it('unità non di massa con riga PESO_NETTO: SENZA_QUANTITA', async () => {
      const s = await scenario(0)
      const p = await calcola(s, { unit: 'NR' })
      expect(p.motivi).toEqual(['SENZA_QUANTITA'])
      expect(p.righe[0]).toMatchObject({ quantita: null, quantitaOrigine: null, importo: null })
      expect(p.stato).toBe('DA_COLLEGARE')
    })

    it('riga a prezzo speciale: prezzo null e nessun SENZA_PREZZO, l’IVA si copia', async () => {
      const s = await scenario(0)
      await owner.rigaAddebito.update({
        where: { id: s.rigaCerId },
        data: { prezzoSpeciale: true, prezzo: null, applicaA: 'DOCUMENTO' },
      })
      const p = await calcola(s)
      expect(p.righe[0]).toMatchObject({
        prezzoSpeciale: true,
        prezzo: null,
        sconto: null,
        importo: null,
        aliquotaIva: '22',
      })
      expect(p.motivi).toEqual([])
      expect(p.stato).toBe('PROPOSTO')
    })

    it('sconto e IVA con natura del listino copiati nella vista', async () => {
      const s = await scenario(0)
      const lst = await owner.codiceIva.findFirstOrThrow({
        where: { tenantId: s.tenantId, codice: 'N61' },
      })
      await owner.rigaAddebito.update({
        where: { id: s.rigaCerId },
        data: { sconto: '10', codiceIvaId: lst.id },
      })
      const p = await calcola(s)
      expect(p.righe[0]).toMatchObject({
        sconto: '10',
        aliquotaIva: '0',
        naturaIva: 'N6.1',
        importo: '90.00',
      })
    })
  })

  describe('sede del produttore (§8.1)', () => {
    it('con il FIR la sede la ricava il server; una sede diversa nel corpo: 400', async () => {
      const s = await scenario()
      const estranea = (await creaDittaConRuolo(owner, s.tenantId, 'PRODUTTORE')).sedeId
      await expect(calcola(s, { producerSedeId: estranea })).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(await calcola(s, { producerSedeId: s.sedeId })).toMatchObject({ stato: 'PROPOSTO' })
    })

    it('senza FIR la sede del corpo vale per la scelta del contratto', async () => {
      const s = await scenario()
      const sede = (await creaDittaConRuolo(owner, s.tenantId, 'PRODUTTORE')).sedeId
      await owner.contrattoCliente.update({ where: { id: s.contrattoId }, data: { sedeId: sede } })
      const p = await calcola(s, { firId: null, producerSedeId: sede }, { clienteId: s.clienteId })
      expect(p).toMatchObject({ stato: 'PROPOSTO', contratto: { id: s.contrattoId } })
    })
  })

  describe('forma delle query', () => {
    it('quante righe V ci siano, le query sono sempre le stesse (una per lista)', async () => {
      const poche = await scenario(1)
      const molte = await scenario(40)
      const conta = async (s: ScenarioProposta) => {
        let n = 0
        await nel(s.tenantId, () =>
          app.$transaction(async tx => {
            const contato = new Proxy(tx, {
              get(t, p, r) {
                const v = Reflect.get(t, p, r)
                if (p === '$queryRaw' || p === '$queryRawUnsafe' || p === '$executeRaw') {
                  return (...a: unknown[]) => {
                    n++
                    return (v as (...x: unknown[]) => unknown).apply(t, a)
                  }
                }
                return v
              },
            })
            const p = await service.calcolaInTx(contato, s.tenantId, input(s))
            expect(p.stato).toBe('PROPOSTO')
          })
        )
        return n
      }
      const nPoche = await conta(poche)
      const nMolte = await conta(molte)
      expect(nMolte).toBe(nPoche)
      expect(nMolte).toBeLessThanOrEqual(12)
    })
  })

  describe('fatturazione da dentro la transazione', () => {
    it('leggiFatturazioneDaInTx: data o null; con condividi la riga resta bloccata FOR SHARE', async () => {
      const s = await scenario(0, '2026-02-02')
      const nessuna = await scenario(0, null)
      const da = await nel(s.tenantId, () =>
        app.$transaction(tx => leggiFatturazioneDaInTx(tx, s.tenantId))
      )
      expect(da).toBe('2026-02-02')
      const spenta = await nel(nessuna.tenantId, () =>
        app.$transaction(tx => leggiFatturazioneDaInTx(tx, nessuna.tenantId))
      )
      expect(spenta).toBeNull()

      // Chi tiene la riga FOR SHARE fa aspettare un FOR UPDATE (chi imposta la data).
      let rilascia!: () => void
      const gate = new Promise<void>(r => (rilascia = r))
      let tenuto!: () => void
      const preso = new Promise<void>(r => (tenuto = r))
      const lettore = nel(s.tenantId, () =>
        app.$transaction(
          async tx => {
            await leggiFatturazioneDaInTx(tx, s.tenantId, { condividi: true })
            tenuto()
            await gate
          },
          { timeout: 60_000, maxWait: 30_000 }
        )
      )
      await preso
      // Chi imposta la data (FOR UPDATE, stessa applicazione) aspetta finche' il lettore non chiude.
      let scritto = false
      const scrittore = nel(s.tenantId, () =>
        app.$transaction(
          async tx => {
            await tx.$queryRaw`SELECT 1 FROM impostazioni_fatturazione WHERE tenant_id = ${s.tenantId}::uuid FOR UPDATE`
          },
          { timeout: 60_000, maxWait: 30_000 }
        )
      ).finally(() => (scritto = true))
      await attendiLock(1, () => scritto)
      rilascia()
      await lettore
      await scrittore
    })
  })

  // -------------------------------------------------------------------------------------------
  // Barriere su pg_stat_activity
  // -------------------------------------------------------------------------------------------
  async function inAttesaDiLock(): Promise<number> {
    const r = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
        AND wait_event_type = 'Lock'`
    return r[0].n
  }
  async function attendiLock(n: number, finita: () => boolean): Promise<void> {
    const scadenza = Date.now() + 30_000
    for (;;) {
      if ((await inAttesaDiLock()) >= n) return
      if (finita()) throw new Error('la transazione è finita senza attendere il lock')
      if (Date.now() > scadenza) throw new Error(`nessuna sessione in attesa di lock (attese ${n})`)
      await new Promise(r => setTimeout(r, 20))
    }
  }

  describe('proponiEScrivi', () => {
    const scrivi = (s: ScenarioProposta, o: Partial<InputProposta> = {}) =>
      nel(s.tenantId, () =>
        app.$transaction(
          tx =>
            service.proponiEScrivi(tx, {
              tenantId: s.tenantId,
              userId: s.utenteId,
              registroId: s.registroId,
              verso: 'CARICO',
              movimentoOriginaleId: s.movimentoId,
              movimentoVigenteId: s.movimentoId,
              input: input(s, o),
            }),
          { timeout: 60_000, maxWait: 30_000 }
        )
      )

    it('scrive la testata e le righe (PROPOSTO) e non tocca il registro', async () => {
      const s = await scenario(1)
      const prima = await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })
      const r = await scrivi(s)
      expect(r.creato).toBe(true)
      expect(r.legameId).toEqual(expect.any(String))
      const l = await owner.legameMovimento.findUniqueOrThrow({
        where: { id: r.legameId as string },
        include: { righe: true },
      })
      expect(l).toMatchObject({
        stato: 'PROPOSTO',
        movimentoOriginaleId: s.movimentoId,
        movimentoVigenteId: s.movimentoId,
        clienteId: s.clienteId,
        fonteCliente: 'FIR',
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        versione: 1,
        creatoDa: s.utenteId,
        motivi: [],
      })
      expect(l.dataMovimento.toISOString().slice(0, 10)).toBe('2026-03-01')
      expect(l.righe).toHaveLength(2)
      const dopo = await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })
      expect(dopo).toEqual(prima)
    })

    it('di nuovo per la stessa radice: restituisce il legame esistente, nessun errore e nessun doppione', async () => {
      const s = await scenario(1)
      const a = await scrivi(s)
      const b = await scrivi(s)
      expect(b).toMatchObject({ creato: false, legameId: a.legameId })
      expect(await legamiDi(s.tenantId)).toBe(1)
      expect(await owner.rigaLegameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(2)
    })

    it('due richieste in parallelo sulla stessa radice: un solo legame, un solo creato', async () => {
      const s = await scenario(1)
      const [a, b] = await Promise.all([scrivi(s), scrivi(s)])
      expect([a.creato, b.creato].sort()).toEqual([false, true])
      expect(a.legameId).toBe(b.legameId)
      expect(await legamiDi(s.tenantId)).toBe(1)
    })

    it('fatturazione spenta o causale non fatturabile: niente scritto', async () => {
      const spenta = await scenario(1, null)
      expect(await scrivi(spenta)).toMatchObject({ legameId: null, creato: false })
      const s = await scenario(1)
      expect(await scrivi(s, { causale: 'PRODUZIONE_INTERNA' })).toMatchObject({
        legameId: null,
        creato: false,
      })
      expect(await legamiDi(spenta.tenantId)).toBe(0)
      expect(await legamiDi(s.tenantId)).toBe(0)
    })

    it('incompleta: DA_COLLEGARE con i motivi, senza FIR', async () => {
      const s = await scenario(1)
      const r = await scrivi(s, { firId: null })
      const l = await owner.legameMovimento.findUniqueOrThrow({ where: { id: r.legameId! } })
      expect(l).toMatchObject({
        stato: 'DA_COLLEGARE',
        clienteId: null,
        motivi: ['SENZA_CLIENTE'],
      })
    })

    it('una modifica del listino in corso fa aspettare la proposta, che poi vede il valore nuovo', async () => {
      const s = await scenario(0)
      let rilascia!: () => void
      const gate = new Promise<void>(r => (rilascia = r))
      let tenuto!: () => void
      const preso = new Promise<void>(r => (tenuto = r))
      const modifica = owner.$transaction(
        async tx => {
          await tx.$executeRaw`UPDATE righe_addebito SET prezzo = 2 WHERE id = ${s.rigaCerId}::uuid`
          tenuto()
          await gate
        },
        { timeout: 60_000, maxWait: 30_000 }
      )
      await preso
      let finita = false
      const proposta = scrivi(s).finally(() => (finita = true))
      await attendiLock(1, () => finita)
      rilascia()
      await modifica
      const r = await proposta
      expect(r.creato).toBe(true)
      const righe = await owner.rigaLegameMovimento.findMany({ where: { legameId: r.legameId! } })
      expect(righe).toHaveLength(1)
      expect(righe[0].prezzo?.toFixed()).toBe('2')
    })
  })

  describe('tenant e RLS', () => {
    it('la proposta di un’azienda non vede il listino di un’altra', async () => {
      const a = await scenario()
      const b = await scenario()
      // FIR di B con il contesto di A: nessun cliente.
      const p = await nel(a.tenantId, () =>
        service.calcola(a.tenantId, input(a, { firId: b.firId }))
      )
      expect(p.cliente).toBeNull()
    })
  })
})
