/**
 * Azioni sul listino (4.2b, Task 23) contro un Postgres reale, collegato COME `wasteflow_app`:
 * copia di elenchi e di righe, provvigione e sconto su tutto il contratto. Il proprietario prepara
 * aziende e contratti e legge lo stato finale. Pulizia solo per id esatti creati.
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

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
} from '../../test-support/listino-di-test'
import { AzioniListinoService } from './azioni-listino.service'
import { RigheAddebitoService } from './righe-addebito.service'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('AzioniListinoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let righe: RigheAddebitoService
  let azioni: AzioniListinoService
  const tenantCreati: string[] = []
  let n = 0

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    righe = new RigheAddebitoService(app)
    azioni = new AzioniListinoService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      await owner.contrattoCliente.updateMany({
        where: { tenantId: in_ },
        data: { contrattoPrincipaleId: null },
      })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.addebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codificaAddebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codiceIva.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: in_ } })
      await owner.user.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Azioni SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-azioni-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `azioni-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const listino = await creaCodiciIvaEcodifiche(owner, t.id)
    return { tenantId: t.id, utenteId: utente.id, listino }
  }

  /** Azienda con codici, un contratto `ATTIVO` (cliente nuovo) e il suo primo elenco `001`. */
  async function scenario() {
    const a = await azienda()
    const c = await creaContrattoConElenco(owner, a.tenantId)
    return { ...a, ...c }
  }
  type Scenario = Awaited<ReturnType<typeof scenario>>

  /** Altro contratto (altro cliente) nella stessa azienda, col suo elenco. */
  const altroContratto = (
    s: Scenario,
    opzioni: Parameters<typeof creaContrattoConElenco>[2] = {}
  ) => creaContrattoConElenco(owner, s.tenantId, opzioni)

  /** Riga creata dal servizio vero (quindi valida), con un addebito nuovo dello stesso tipo. */
  async function riga(
    s: Scenario,
    elencoId: string,
    tipo: string,
    extra: Record<string, unknown> = {},
    unitaMisura = 'KG'
  ) {
    const a = await creaAddebito(owner, s.tenantId, {
      tipo,
      unitaMisura: tipo === 'V' ? 'KG' : unitaMisura,
    })
    const eFisso = tipo === 'F'
    return righe.crea(s.tenantId, s.utenteId, elencoId, {
      codiceIvaId: s.listino.iva22Id,
      tipo,
      addebitoId: a.id,
      unitaMisura,
      prezzo: '2',
      ...(tipo === 'V' ? { tipoQuantita: 'PESO_NETTO' } : {}),
      ...(eFisso
        ? {
            quantitaFissa: '2',
            periodoScadenze: 'MP',
            scadenze: [
              { ordine: 1, giorno: 1, mese: 3, anno: null },
              { ordine: 2, giorno: 1, mese: 9, anno: null },
            ],
          }
        : {}),
      ...extra,
    })
  }

  const SPECIALE = {
    prezzoSpeciale: true,
    prezzo: null,
    applicaA: 'DOCUMENTO',
    scaglioni: [
      { ordine: 1, finoA: '100', prezzo: '1', tipoCalcolo: 'A' },
      { ordine: 7, finoA: null, prezzo: '0.5', tipoCalcolo: 'A' },
    ],
  }

  const CONGUAGLIO = {
    ...SPECIALE,
    applicaA: 'CONGUAGLIO_365',
    riferimentoGiorno: 31,
    riferimentoMese: 12,
  }

  const versioneElenco = async (id: string) =>
    (await owner.elencoAddebiti.findUniqueOrThrow({ where: { id } })).versione
  const righeDi = (elencoId: string) =>
    owner.rigaAddebito.findMany({
      where: { elencoId },
      include: { scaglioni: true, scadenze: true },
      orderBy: { createdAt: 'asc' },
    })

  // -----------------------------------------------------------------------------------------
  describe('sostituisci-da', () => {
    it('da un elenco di un altro cliente: esclusi MW, $A e conguaglio, il resto con fasce e scadenze', async () => {
      const s = await scenario()
      const altro = await altroContratto(s)
      await riga(s, altro.elencoId, 'V', SPECIALE)
      await riga(s, altro.elencoId, 'F', {}, 'NR')
      await riga(s, altro.elencoId, 'MW', {}, 'EUR')
      await riga(s, altro.elencoId, '$A', {}, 'EUR')
      await riga(s, altro.elencoId, 'V', CONGUAGLIO)
      // una riga che c'era nell'elenco di arrivo sparisce
      const vecchia = await riga(s, s.elencoId, 'V')
      const sorgenteIdPrima = (await righeDi(altro.elencoId)).map(r => r.id)

      const esito = await azioni.sostituisciDa(s.tenantId, s.utenteId, s.elencoId, {
        daElencoId: altro.elencoId,
        versione: 1,
      })

      expect(esito).toEqual({
        copiate: 2,
        escluse: { minimi: 1, acconti: 1, conguagli: 1, duplicate: 0, condizioni: 0 },
      })
      const arrivo = await righeDi(s.elencoId)
      expect(arrivo.map(r => r.tipo).sort()).toEqual(['F', 'V'])
      expect(arrivo.some(r => r.id === vecchia.id)).toBe(false)
      // nuovi id, versione 1, fasce e scadenze copiate
      expect(arrivo.every(r => !sorgenteIdPrima.includes(r.id) && r.versione === 1)).toBe(true)
      expect(arrivo.find(r => r.tipo === 'V')?.scaglioni.map(f => f.ordine)).toEqual(
        expect.arrayContaining([1, 7])
      )
      expect(arrivo.find(r => r.tipo === 'F')?.scadenze).toHaveLength(2)
      // la sorgente non cambia, l'elenco di arrivo cambia versione, il contratto no
      expect((await righeDi(altro.elencoId)).map(r => r.id)).toEqual(sorgenteIdPrima)
      expect(await versioneElenco(s.elencoId)).toBe(2)
      expect(
        (await owner.contrattoCliente.findUniqueOrThrow({ where: { id: s.contrattoId } })).versione
      ).toBe(1)
      // audit con i conteggi
      const log = await owner.activityLog.findFirstOrThrow({
        where: { tenantId: s.tenantId, action: 'RIGHE_ADDEBITO_ELENCO_SOSTITUITE' },
      })
      expect(log.metadata).toMatchObject({
        elencoId: s.elencoId,
        daElencoId: altro.elencoId,
        copiate: 2,
        minimi: 1,
        acconti: 1,
        conguagli: 1,
      })
    })

    it('su sé stesso: 400 con details.errori; nulla cambia', async () => {
      const s = await scenario()
      await riga(s, s.elencoId, 'V')
      const e = await errore(
        azioni.sostituisciDa(s.tenantId, s.utenteId, s.elencoId, {
          daElencoId: s.elencoId,
          versione: 1,
        })
      )
      expect(e.getStatus()).toBe(400)
      expect(e.getResponse().details.errori).toEqual([
        { campo: null, messaggio: 'Un elenco non si copia su sé stesso.' },
      ])
      expect(await righeDi(s.elencoId)).toHaveLength(1)
    })

    it('D17: verso un allegato con righe non T → 400 e l’elenco di arrivo resta com’era', async () => {
      const principale = await scenario()
      const allegato = await altroContratto(principale, {
        contrattoPrincipaleId: principale.contrattoId,
        clienteId: principale.clienteId,
      })
      // un elenco sorgente con una V, una CER e una TS
      const sorgente = await altroContratto(principale)
      await riga(principale, sorgente.elencoId, 'V')
      await riga(principale, sorgente.elencoId, 'TS')
      await riga(principale, sorgente.elencoId, 'MW', {}, 'EUR')
      await owner.rigaAddebito.create({
        data: {
          tenantId: principale.tenantId,
          elencoId: sorgente.elencoId,
          tipo: 'CER',
          cerCode: '20 03 01',
          tipoQuantita: 'PESO_NETTO',
          unitaMisura: 'KG',
          prezzo: '1',
          codiceIvaId: principale.listino.iva22Id,
          tipologiaRifiuto: 'URBANO',
        },
      })
      const inAllegato = await riga(principale, allegato.elencoId, 'TS')

      const e = await errore(
        azioni.sostituisciDa(principale.tenantId, principale.utenteId, allegato.elencoId, {
          daElencoId: sorgente.elencoId,
          versione: 1,
        })
      )
      expect(e.getStatus()).toBe(400)
      const messaggi: string[] = e.getResponse().details.errori.map((x: any) => x.messaggio)
      expect(messaggi.some(m => m.includes('solo addebiti di tipo T'))).toBe(true)
      expect(messaggi.some(m => m.includes('righe CER'))).toBe(true)
      // il MW (non T) è escluso e non causa errori: nessuna riga non T è scritta
      expect((await righeDi(allegato.elencoId)).map(r => r.id)).toEqual([inAllegato.id])
      expect(await versioneElenco(allegato.elencoId)).toBe(1)
    })

    it('D17: un elenco sorgente con soli T e un minimo si copia nell’allegato, il minimo escluso', async () => {
      const principale = await scenario()
      const allegato = await altroContratto(principale, {
        contrattoPrincipaleId: principale.contrattoId,
        clienteId: principale.clienteId,
      })
      const sorgente = await altroContratto(principale)
      await riga(principale, sorgente.elencoId, 'TS')
      await riga(principale, sorgente.elencoId, 'MW', {}, 'EUR')
      const esito = await azioni.sostituisciDa(
        principale.tenantId,
        principale.utenteId,
        allegato.elencoId,
        { daElencoId: sorgente.elencoId, versione: 1 }
      )
      expect(esito.copiate).toBe(1)
      expect(esito.escluse.minimi).toBe(1)
      expect((await righeDi(allegato.elencoId)).map(r => r.tipo)).toEqual(['TS'])
    })

    it('dati preesistenti: una somma senza il suo condizionato non si copia e si conta', async () => {
      const s = await scenario()
      const altro = await altroContratto(s)
      const tabella = [
        { ordine: 1, finoA: '10', prezzo: '1', tipoCalcolo: 'X' },
        { ordine: 7, finoA: null, prezzo: '1', tipoCalcolo: 'A' },
      ]
      await riga(s, altro.elencoId, 'V', { condizione: 1 })
      const senzaCondizionato = await riga(s, altro.elencoId, 'V', { condizione: 2 })
      await riga(s, altro.elencoId, 'V', {
        ...SPECIALE,
        scaglioni: tabella,
        condizioniRiferite: '2C',
      })
      await riga(s, altro.elencoId, 'V', {
        ...SPECIALE,
        scaglioni: tabella,
        condizioniRiferite: '1C',
      })
      // il condizionato 2 sparisce (dato non coerente, come potrebbe arrivare da un import)
      await owner.rigaAddebito.delete({ where: { id: senzaCondizionato.id } })
      const esito = await azioni.sostituisciDa(s.tenantId, s.utenteId, s.elencoId, {
        daElencoId: altro.elencoId,
        versione: 1,
      })
      expect(esito.copiate).toBe(2)
      expect(esito.escluse).toMatchObject({ condizioni: 1 })
      const arrivo = await righeDi(s.elencoId)
      expect(arrivo.map(r => r.condizioniRiferite).sort()).toEqual(['1C', null])
    })

    it('errori: versione vecchia 409, altra azienda 404, contratto annullato o eliminato', async () => {
      const s = await scenario()
      const altro = await altroContratto(s)
      await riga(s, altro.elencoId, 'V')
      const vecchia = await errore(
        azioni.sostituisciDa(s.tenantId, s.utenteId, s.elencoId, {
          daElencoId: altro.elencoId,
          versione: 7,
        })
      )
      expect(vecchia.getStatus()).toBe(409)

      const estranea = await scenario()
      // sorgente di un'altra azienda: 404
      const e1 = await errore(
        azioni.sostituisciDa(s.tenantId, s.utenteId, s.elencoId, {
          daElencoId: estranea.elencoId,
          versione: 1,
        })
      )
      expect(e1.getStatus()).toBe(404)
      // elenco di arrivo di un'altra azienda: 404
      const e2 = await errore(
        azioni.sostituisciDa(s.tenantId, s.utenteId, estranea.elencoId, {
          daElencoId: altro.elencoId,
          versione: 1,
        })
      )
      expect(e2.getStatus()).toBe(404)

      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'Prova', annullatoIl: new Date() },
      })
      const e3 = await errore(
        azioni.sostituisciDa(s.tenantId, s.utenteId, s.elencoId, {
          daElencoId: altro.elencoId,
          versione: 1,
        })
      )
      expect(e3.getStatus()).toBe(409)
      expect(e3.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
      // da un contratto annullato si può invece copiare
      const dest = await altroContratto(s)
      const ok = await azioni.sostituisciDa(s.tenantId, s.utenteId, dest.elencoId, {
        daElencoId: s.elencoId,
        versione: 1,
      })
      expect(ok.copiate).toBe(0)

      await owner.contrattoCliente.update({
        where: { id: altro.contrattoId },
        data: { eliminatoIl: new Date() },
      })
      const e4 = await errore(
        azioni.sostituisciDa(s.tenantId, s.utenteId, dest.elencoId, {
          daElencoId: altro.elencoId,
          versione: 2,
        })
      )
      expect(e4.getStatus()).toBe(404)
    })

    it('due copie incrociate A←B e B←A (contratti diversi): nessun deadlock, entrambe riescono', async () => {
      const s = await scenario()
      const altro = await altroContratto(s)
      await riga(s, s.elencoId, 'V')
      await riga(s, altro.elencoId, 'V')
      const [basso, alto] = [s.elencoId, altro.elencoId].sort()

      // Barriera: una transazione del proprietario tiene l'elenco con l'id più basso. Le due copie
      // si mettono in coda lì (entrambe chiedono PRIMA il più basso, qualunque sia la destinazione);
      // se ne chiedessero uno ciascuna in ordine diverso, rilasciata la barriera andrebbero in deadlock.
      let rilascia!: () => void
      const barriera = new Promise<void>(r => (rilascia = r))
      let tenuto!: () => void
      const eTenuto = new Promise<void>(r => (tenuto = r))
      const tenitore = owner.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM "elenchi_addebiti" WHERE id = ${basso}::uuid FOR UPDATE`
          tenuto()
          await barriera
        },
        { timeout: 60_000 }
      )
      await eTenuto

      const copia1 = azioni.sostituisciDa(s.tenantId, s.utenteId, basso, {
        daElencoId: alto,
        versione: 1,
      })
      const copia2 = azioni.sostituisciDa(s.tenantId, s.utenteId, alto, {
        daElencoId: basso,
        versione: 1,
      })
      // Attesa di una condizione (non un tempo fisso): entrambe le copie sono ferme su un lock.
      const inAttesa = async () => {
        for (let i = 0; i < 400; i++) {
          const [r] = await owner.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query ILIKE '%elenchi_addebiti%'
              AND datname = current_database()`
          if (r.n >= 2) return true
          await new Promise(res => setImmediate(res))
        }
        return false
      }
      const fermeTutteDue = await inAttesa()
      rilascia()
      await tenitore
      const esiti = await Promise.allSettled([copia1, copia2])
      expect(fermeTutteDue).toBe(true)
      expect(esiti.map(e => e.status)).toEqual(['fulfilled', 'fulfilled'])
    })
  })

  // -----------------------------------------------------------------------------------------
  describe('aggiungi-righe', () => {
    it('copie delle righe scelte da più elenchi; duplicato saltato; M e $ esclusi; riga di un altro azienda 404', async () => {
      const s = await scenario()
      const e2 = await altroContratto(s)
      const e3 = await altroContratto(s)
      const v1 = await riga(s, e2.elencoId, 'V')
      const f1 = await riga(s, e3.elencoId, 'F', {}, 'NR')
      const mw = await riga(s, e2.elencoId, 'MW', {}, 'EUR')
      const acc = await riga(s, e3.elencoId, '$A', {}, 'EUR')
      // già nell'elenco di arrivo: stesso addebito, stesso riferimento
      const esistente = await righe.crea(s.tenantId, s.utenteId, s.elencoId, {
        codiceIvaId: s.listino.iva22Id,
        tipo: 'V',
        addebitoId: v1.addebito?.id,
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzo: '9',
      })

      const esito = await azioni.aggiungiRighe(s.tenantId, s.utenteId, s.elencoId, {
        righeIds: [v1.id, f1.id, mw.id, acc.id, f1.id],
        versione: 1,
      })
      expect(esito).toEqual({
        copiate: 1,
        escluse: { minimi: 1, acconti: 1, conguagli: 0, duplicate: 1, condizioni: 0 },
      })
      const arrivo = await righeDi(s.elencoId)
      expect(arrivo.map(r => r.tipo).sort()).toEqual(['F', 'V'])
      // il duplicato non ha sovrascritto la riga che c'era (prezzo 9)
      expect(arrivo.find(r => r.id === esistente.id)?.prezzo?.toFixed(0)).toBe('9')
      expect(arrivo.find(r => r.tipo === 'F')?.scadenze).toHaveLength(2)
      expect(await versioneElenco(s.elencoId)).toBe(2)
      const log = await owner.activityLog.findFirstOrThrow({
        where: { tenantId: s.tenantId, action: 'RIGHE_ADDEBITO_COPIATE' },
      })
      expect(log.metadata).toMatchObject({ copiate: 1, duplicate: 1, minimi: 1, acconti: 1 })

      // una riga di un'altra azienda: 404 e nulla è scritto
      const estranea = await scenario()
      const r = await riga(estranea, estranea.elencoId, 'V')
      const e = await errore(
        azioni.aggiungiRighe(s.tenantId, s.utenteId, s.elencoId, {
          righeIds: [r.id],
          versione: 2,
        })
      )
      expect(e.getStatus()).toBe(404)
      expect(await righeDi(s.elencoId)).toHaveLength(2)
    })

    it('le cifre delle condizioni già sommate nell’elenco di arrivo escludono la riga (I1 della review 21)', async () => {
      const s = await scenario()
      const altro = await altroContratto(s)
      const terzo = await altroContratto(s)
      const tabella = [
        { ordine: 1, finoA: '10', prezzo: '1', tipoCalcolo: 'X' },
        { ordine: 7, finoA: null, prezzo: '1', tipoCalcolo: 'A' },
      ]
      const somma = (condizioniRiferite: string) => ({
        ...SPECIALE,
        scaglioni: tabella,
        condizioniRiferite,
      })
      await riga(s, s.elencoId, 'V', { condizione: 1 })
      await riga(s, s.elencoId, 'V', { condizione: 2 })
      await riga(s, s.elencoId, 'V', somma('1C'))
      await riga(s, altro.elencoId, 'V', { condizione: 1 })
      await riga(s, altro.elencoId, 'V', { condizione: 2 })
      const sommaSovrapposta = await riga(s, altro.elencoId, 'V', somma('12P'))
      await riga(s, terzo.elencoId, 'V', { condizione: 2 })
      const sommaLibera = await riga(s, terzo.elencoId, 'V', somma('2C'))
      const esito = await azioni.aggiungiRighe(s.tenantId, s.utenteId, s.elencoId, {
        righeIds: [sommaSovrapposta.id, sommaLibera.id],
        versione: 1,
      })
      // '12P' somma anche la 1, già sommata da '1C'; '2C' invece è libera
      expect(esito.copiate).toBe(1)
      expect(esito.escluse.condizioni).toBe(1)
      const sommate = (await righeDi(s.elencoId)).map(r => r.condizioniRiferite).filter(Boolean)
      expect(sommate.sort()).toEqual(['1C', '2C'])
    })

    it('D17: verso un allegato 400 se tra le scelte c’è una riga non T; ok con le T', async () => {
      const principale = await scenario()
      const allegato = await altroContratto(principale, {
        contrattoPrincipaleId: principale.contrattoId,
        clienteId: principale.clienteId,
      })
      const sorgente = await altroContratto(principale)
      const v = await riga(principale, sorgente.elencoId, 'V')
      const t = await riga(principale, sorgente.elencoId, 'TS')
      const e = await errore(
        azioni.aggiungiRighe(principale.tenantId, principale.utenteId, allegato.elencoId, {
          righeIds: [v.id, t.id],
          versione: 1,
        })
      )
      expect(e.getStatus()).toBe(400)
      expect(e.getResponse().details.errori[0].messaggio).toContain('solo addebiti di tipo T')
      expect(await righeDi(allegato.elencoId)).toHaveLength(0)
      const ok = await azioni.aggiungiRighe(
        principale.tenantId,
        principale.utenteId,
        allegato.elencoId,
        { righeIds: [t.id], versione: 1 }
      )
      expect(ok.copiate).toBe(1)
      expect((await righeDi(allegato.elencoId)).map(r => r.tipo)).toEqual(['TS'])
    })

    it('contratto annullato 409; versione vecchia 409', async () => {
      const s = await scenario()
      const altro = await altroContratto(s)
      const r = await riga(s, altro.elencoId, 'V')
      const vecchia = await errore(
        azioni.aggiungiRighe(s.tenantId, s.utenteId, s.elencoId, { righeIds: [r.id], versione: 4 })
      )
      expect(vecchia.getStatus()).toBe(409)
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'Prova', annullatoIl: new Date() },
      })
      const e = await errore(
        azioni.aggiungiRighe(s.tenantId, s.utenteId, s.elencoId, { righeIds: [r.id], versione: 1 })
      )
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
    })
  })

  // -----------------------------------------------------------------------------------------
  describe('provvigioni su tutto il contratto', () => {
    it('imposta su tutte le righe non speciali; $D escluse e contate; speciali contate e intatte', async () => {
      const s = await scenario()
      const e2 = await altroElencoDelContratto(s, '002')
      const normale = await riga(s, s.elencoId, 'V')
      const fissa = await riga(s, e2.id, 'F', {}, 'NR')
      const speciale = await riga(s, s.elencoId, 'V', SPECIALE)
      const detr = await riga(s, e2.id, '$D', {}, 'EUR')

      const esito = await azioni.impostaProvvigioni(s.tenantId, s.utenteId, s.contrattoId, {
        provvigione: '5 + 2',
        tipoProvvigione: 'lordo',
      })
      expect(esito).toEqual({ aggiornate: 2, speciali: 1, escluse: 1 })
      const get = (id: string) => owner.rigaAddebito.findUniqueOrThrow({ where: { id } })
      expect(await get(normale.id)).toMatchObject({
        provvigione: '5+2',
        tipoProvvigione: 'LORDO',
        versione: 2,
      })
      expect(await get(fissa.id)).toMatchObject({ provvigione: '5+2', versione: 2 })
      expect(await get(speciale.id)).toMatchObject({ provvigione: null, versione: 1 })
      expect(await get(detr.id)).toMatchObject({ provvigione: null, versione: 1 })

      // stesso valore: nessuna riga cambia e le versioni non salgono
      const ancora = await azioni.impostaProvvigioni(s.tenantId, s.utenteId, s.contrattoId, {
        provvigione: '5+2',
        tipoProvvigione: 'LORDO',
      })
      expect(ancora.aggiornate).toBe(0)
      expect((await get(normale.id)).versione).toBe(2)

      // provvigione vuota: svuota provvigione e tipo (R45)
      const vuota = await azioni.impostaProvvigioni(s.tenantId, s.utenteId, s.contrattoId, {
        provvigione: null,
        tipoProvvigione: 'LORDO',
      })
      expect(vuota.aggiornate).toBe(2)
      expect(await get(normale.id)).toMatchObject({
        provvigione: null,
        tipoProvvigione: null,
        versione: 3,
      })
      const log = await owner.activityLog.findFirstOrThrow({
        where: { tenantId: s.tenantId, action: 'PROVVIGIONI_CONTRATTO_IMPOSTATE' },
        orderBy: { createdAt: 'asc' },
      })
      expect(log.metadata).toMatchObject({
        contrattoId: s.contrattoId,
        provvigione: '5+2',
        aggiornate: 2,
        speciali: 1,
        escluse: 1,
      })
      // il contratto non cambia versione (D16)
      expect(
        (await owner.contrattoCliente.findUniqueOrThrow({ where: { id: s.contrattoId } })).versione
      ).toBe(1)
    })

    it('errori: formula non valida e tipo mancante 400 con details.errori; annullato 409; altra azienda 404', async () => {
      const s = await scenario()
      const formula = await errore(
        azioni.impostaProvvigioni(s.tenantId, s.utenteId, s.contrattoId, {
          provvigione: '1+2+3+4',
          tipoProvvigione: 'LORDO',
        })
      )
      expect(formula.getStatus()).toBe(400)
      expect(formula.getResponse().details.errori[0]).toMatchObject({ campo: 'provvigione' })
      const tipo = await errore(
        azioni.impostaProvvigioni(s.tenantId, s.utenteId, s.contrattoId, {
          provvigione: '5',
          tipoProvvigione: null,
        })
      )
      expect(tipo.getResponse().details.errori).toEqual([
        { campo: 'tipoProvvigione', messaggio: 'Indica su cosa si calcola la provvigione.' },
      ])
      const estranea = await scenario()
      const altra = await errore(
        azioni.impostaProvvigioni(estranea.tenantId, estranea.utenteId, s.contrattoId, {
          provvigione: '5',
          tipoProvvigione: 'LORDO',
        })
      )
      expect(altra.getStatus()).toBe(404)
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'Prova', annullatoIl: new Date() },
      })
      const annullato = await errore(
        azioni.impostaProvvigioni(s.tenantId, s.utenteId, s.contrattoId, {
          provvigione: '5',
          tipoProvvigione: 'LORDO',
        })
      )
      expect(annullato.getStatus()).toBe(409)
    })
  })

  // -----------------------------------------------------------------------------------------
  describe('sostituzione dello sconto', () => {
    it('"10 + 5" cambia solo le righe con 10+5; le speciali con quello sconto sono contate', async () => {
      const s = await scenario()
      const e2 = await altroElencoDelContratto(s, '002')
      const a = await riga(s, s.elencoId, 'V', { sconto: '10 + 5' })
      const b = await riga(s, e2.id, 'F', { sconto: '10+5' }, 'NR')
      const c = await riga(s, s.elencoId, 'V', { sconto: '10' })
      const d = await riga(s, e2.id, 'V')
      const speciale = await riga(s, s.elencoId, 'V', {
        ...SPECIALE,
        scaglioni: [
          { ordine: 1, finoA: '100', prezzo: '1', sconto: '10+5', tipoCalcolo: 'A' },
          { ordine: 7, finoA: null, prezzo: '0.5', tipoCalcolo: 'A' },
        ],
      })

      const esito = await azioni.sostituisciSconto(s.tenantId, s.utenteId, s.contrattoId, {
        scontoAttuale: '10+5',
        scontoNuovo: '12',
      })
      expect(esito).toEqual({ aggiornate: 2, speciali: 1, escluse: 0 })
      const get = (id: string) => owner.rigaAddebito.findUniqueOrThrow({ where: { id } })
      expect(await get(a.id)).toMatchObject({ sconto: '12', versione: 2 })
      expect(await get(b.id)).toMatchObject({ sconto: '12', versione: 2 })
      expect(await get(c.id)).toMatchObject({ sconto: '10', versione: 1 })
      expect(await get(d.id)).toMatchObject({ sconto: null, versione: 1 })
      expect(await get(speciale.id)).toMatchObject({ versione: 1 })
      const log = await owner.activityLog.findFirstOrThrow({
        where: { tenantId: s.tenantId, action: 'SCONTI_CONTRATTO_SOSTITUITI' },
      })
      expect(log.metadata).toMatchObject({
        scontoAttuale: '10+5',
        scontoNuovo: '12',
        aggiornate: 2,
        speciali: 1,
      })

      // sconto nuovo vuoto: lo toglie
      const toglie = await azioni.sostituisciSconto(s.tenantId, s.utenteId, s.contrattoId, {
        scontoAttuale: '12',
        scontoNuovo: '',
      })
      expect(toglie.aggiornate).toBe(2)
      expect((await get(a.id)).sconto).toBeNull()
    })

    it('errori: formule non valide 400; annullato 409; altra azienda 404', async () => {
      const s = await scenario()
      const e = await errore(
        azioni.sostituisciSconto(s.tenantId, s.utenteId, s.contrattoId, {
          scontoAttuale: '',
          scontoNuovo: '1+2+3+4',
        })
      )
      expect(e.getStatus()).toBe(400)
      expect(e.getResponse().details.errori.map((x: any) => x.campo)).toEqual([
        'scontoAttuale',
        'scontoNuovo',
      ])
      const estranea = await scenario()
      expect(
        (
          await errore(
            azioni.sostituisciSconto(estranea.tenantId, estranea.utenteId, s.contrattoId, {
              scontoAttuale: '5',
              scontoNuovo: '6',
            })
          )
        ).getStatus()
      ).toBe(404)
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'Prova', annullatoIl: new Date() },
      })
      expect(
        (
          await errore(
            azioni.sostituisciSconto(s.tenantId, s.utenteId, s.contrattoId, {
              scontoAttuale: '5',
              scontoNuovo: '6',
            })
          )
        ).getStatus()
      ).toBe(409)
    })
  })

  /** Secondo elenco nello stesso contratto. */
  const altroElencoDelContratto = (s: Scenario, codice: string) =>
    owner.elencoAddebiti.create({
      data: { tenantId: s.tenantId, contrattoId: s.contrattoId, codice, descrizione: `E${codice}` },
    })
})
