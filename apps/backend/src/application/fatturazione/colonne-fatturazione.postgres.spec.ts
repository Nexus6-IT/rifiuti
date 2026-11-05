/**
 * Colonne nuove della 4.4a nei servizi esistenti (Task 9) contro un Postgres reale, collegato COME
 * `wasteflow_app`, dentro il `TenantContext`: codice IVA delle spese accessorie, suffisso del numero
 * sul registro IVA e controlli «in uso» di righe di listino, codici IVA, registri, clienti,
 * contratti ed elenchi citati da un documento. Il proprietario prepara le fixture e legge lo stato
 * finale. Le barriere guardano `pg_stat_activity` (`wait_event_type = 'Lock'`): mai `sleep` come
 * sincronizzazione. Pulizia solo per id esatti (`pulisciTenantDiTest`).
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
const NOME_APPLICAZIONE = `fatt-t9-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import { TenantContext } from '../../core/context/tenant-context'
import { DittaPrismaRepository } from '../../infrastructure/persistence/ditta-prisma.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaCedenteDiTest, creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import {
  assicuraCatalogoCer,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'
import { ClientiService } from '../clienti/clienti.service'
import { RegistriIvaService } from '../clienti/registri-iva.service'
import { SpeseAccessorieService } from '../clienti/spese-accessorie.service'
import { ContrattiClienteService } from '../contratti-cliente/contratti-cliente.service'
import { CodiciIvaService } from '../listino/codici-iva.service'
import { ElenchiAddebitiService } from '../listino/elenchi-addebiti.service'
import { OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { RigheAddebitoService } from '../listino/righe-addebito.service'
import { DitteService } from '../registry/ditte/ditte.service'
import { riservaNumeri } from './numerazione'
import { annoCorrente } from './suffisso-registro'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}
const codiceErrore = (e: any): unknown => e.getResponse?.().error
const stato = (e: any): number => e.getStatus?.()

describe('Colonne della fatturazione nei servizi esistenti — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let spese: SpeseAccessorieService
  let registri: RegistriIvaService
  let codiciIva: CodiciIvaService
  let righe: RigheAddebitoService
  let elenchi: ElenchiAddebitiService
  let clienti: ClientiService
  let contratti: ContrattiClienteService
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  let n = 0
  const ANNO = annoCorrente()

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    const ditte = new DitteService(app, new DittaPrismaRepository())
    spese = new SpeseAccessorieService(app)
    registri = new RegistriIvaService(app)
    codiciIva = new CodiciIvaService(app)
    righe = new RigheAddebitoService(app)
    elenchi = new ElenchiAddebitiService(app)
    clienti = new ClientiService(app, ditte)
    contratti = new ContrattiClienteService(app, clienti)
    cerCreati.push(...(await assicuraCatalogoCer(owner, ['20 03 01'])))
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Colonne SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-t9-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `t9-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const registro = await owner.registroIva.create({
      data: { tenantId: t.id, codice: '01', descrizione: 'Vendite' },
    })
    const listino = await creaCodiciIvaEcodifiche(owner, t.id)
    return {
      tenantId: t.id,
      utenteId: utente.id,
      registroId: registro.id,
      iva22Id: listino.iva22Id,
      ivaN61Id: listino.ivaN61Id,
    }
  }

  const datiSpesa = (codice: string, extra: Record<string, unknown> = {}) => ({
    tipo: 'INCASSO' as const,
    codice,
    descrizione: 'Spese di incasso',
    importo: '2.50',
    ...extra,
  })

  // -----------------------------------------------------------------------------------------
  describe('spese accessorie: codice IVA', () => {
    it('spesa con codice IVA di un altro tenant: 404 CODICE_IVA_NON_TROVATO', async () => {
      const a = await azienda()
      const b = await azienda()
      const e = await errore(
        nel(a.tenantId, () =>
          spese.crea(a.tenantId, a.utenteId, datiSpesa('X1', { codiceIvaId: b.iva22Id }))
        )
      )
      expect(stato(e)).toBe(404)
      expect(codiceErrore(e)).toBe('CODICE_IVA_NON_TROVATO')
      expect(await owner.spesaAccessoria.count({ where: { tenantId: a.tenantId } })).toBe(0)
    })

    it('spesa senza codice IVA: 200 come prima, codiceIvaId null', async () => {
      const a = await azienda()
      const v = await nel(a.tenantId, () => spese.crea(a.tenantId, a.utenteId, datiSpesa('X2')))
      expect(v.codiceIvaId).toBeNull()
      expect(v.eliminabile).toBe(true)
    })

    it('con codice IVA proprio: lo porta in vista; null lo toglie; lo stesso id e` una modifica nulla', async () => {
      const a = await azienda()
      const v = await nel(a.tenantId, () =>
        spese.crea(a.tenantId, a.utenteId, datiSpesa('X3', { codiceIvaId: a.iva22Id }))
      )
      expect(v.codiceIvaId).toBe(a.iva22Id)
      const stessa = await nel(a.tenantId, () =>
        spese.modifica(a.tenantId, a.utenteId, v.id, {
          codiceIvaId: a.iva22Id,
          versione: v.versione,
        })
      )
      expect(stessa.versione).toBe(v.versione)
      const tolta = await nel(a.tenantId, () =>
        spese.modifica(a.tenantId, a.utenteId, v.id, { codiceIvaId: null, versione: v.versione })
      )
      expect(tolta.codiceIvaId).toBeNull()
      expect(tolta.versione).toBe(v.versione + 1)
      const log = await owner.activityLog.findFirst({
        where: { tenantId: a.tenantId, action: 'SPESA_ACCESSORIA_MODIFICATA' },
        orderBy: { createdAt: 'desc' },
      })
      expect((log?.metadata as { campi: string[] }).campi).toEqual(['codiceIvaId'])
    })

    it('codice IVA della spesa disattivato: la spesa resta, e si puo` ancora modificare', async () => {
      const a = await azienda()
      const v = await nel(a.tenantId, () =>
        spese.crea(a.tenantId, a.utenteId, datiSpesa('X4', { codiceIvaId: a.iva22Id }))
      )
      await owner.codiceIva.update({ where: { id: a.iva22Id }, data: { attivo: false } })
      const letta = await nel(a.tenantId, () => spese.getById(a.tenantId, v.id))
      expect(letta.codiceIvaId).toBe(a.iva22Id)
      const m = await nel(a.tenantId, () =>
        spese.modifica(a.tenantId, a.utenteId, v.id, {
          descrizione: 'Nuova',
          codiceIvaId: a.iva22Id,
          versione: v.versione,
        })
      )
      expect(m.descrizione).toBe('Nuova')
    })

    it('codice IVA citato da una spesa: non eliminabile, delete 409 CODICE_IVA_IN_USO', async () => {
      const a = await azienda()
      await nel(a.tenantId, () =>
        spese.crea(a.tenantId, a.utenteId, datiSpesa('X5', { codiceIvaId: a.ivaN61Id }))
      )
      const lista = await nel(a.tenantId, () => codiciIva.list(a.tenantId, true))
      expect(lista.find(c => c.id === a.ivaN61Id)?.eliminabile).toBe(false)
      expect(lista.find(c => c.id === a.iva22Id)?.eliminabile).toBe(true)
      const riga = await owner.codiceIva.findUniqueOrThrow({ where: { id: a.ivaN61Id } })
      const e = await errore(
        nel(a.tenantId, () => codiciIva.elimina(a.tenantId, a.utenteId, a.ivaN61Id, riga.versione))
      )
      expect(stato(e)).toBe(409)
      expect(codiceErrore(e)).toBe('CODICE_IVA_IN_USO')
    })
  })

  // -----------------------------------------------------------------------------------------
  describe('registro IVA: suffisso del numero', () => {
    const modifica = (
      a: { tenantId: string; utenteId: string },
      id: string,
      suffissoNumero: string | null,
      versione: number
    ) =>
      nel(a.tenantId, () =>
        registri.modifica(a.tenantId, a.utenteId, id, { suffissoNumero, versione })
      )

    it('"/A": 200 e vista con suffissoModificabile; "/A B", 11 caratteri e simboli: 400', async () => {
      const a = await azienda()
      const v = await modifica(a, a.registroId, '/A', 1)
      expect(v.suffissoNumero).toBe('/A')
      expect(v.suffissoModificabile).toBe(true)
      for (const cattivo of ['/A B', '12345678901', 'A.B', 'A_B']) {
        const e = await errore(modifica(a, a.registroId, cattivo, v.versione))
        expect(stato(e)).toBe(400)
        expect(codiceErrore(e)).toBe('REGISTRO_IVA_NON_VALIDO')
      }
      const dieci = await modifica(a, a.registroId, 'A/B-C1234', v.versione)
      expect(dieci.suffissoNumero).toBe('A/B-C1234')
      const vuoto = await modifica(a, a.registroId, '  ', dieci.versione)
      expect(vuoto.suffissoNumero).toBeNull()
    })

    it('alla creazione il suffisso e` facoltativo e validato', async () => {
      const a = await azienda()
      const ok = await nel(a.tenantId, () =>
        registri.crea(a.tenantId, a.utenteId, {
          codice: '02',
          descrizione: 'Con suffisso',
          ricevuteSplit: false,
          suffissoNumero: '/B',
        })
      )
      expect(ok.suffissoNumero).toBe('/B')
      const e = await errore(
        nel(a.tenantId, () =>
          registri.crea(a.tenantId, a.utenteId, {
            codice: '03',
            descrizione: 'Cattivo',
            ricevuteSplit: false,
            suffissoNumero: 'a b',
          })
        )
      )
      expect(stato(e)).toBe(400)
    })

    it('con un DEFINITIVO nell`anno corrente: 409 SUFFISSO_NON_MODIFICABILE, vista non modificabile', async () => {
      const a = await azienda()
      await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: a.registroId,
        anno: ANNO,
      })
      const lista = await nel(a.tenantId, () => registri.list(a.tenantId, true))
      expect(lista[0].suffissoModificabile).toBe(false)
      const e = await errore(modifica(a, a.registroId, '/A', 1))
      expect(stato(e)).toBe(409)
      expect(codiceErrore(e)).toBe('SUFFISSO_NON_MODIFICABILE')
      // Lo stesso valore rimandato non e` un cambio: nessun errore e nessuna scrittura.
      const stesso = await modifica(a, a.registroId, null, 1)
      expect(stesso.versione).toBe(1)
      // Le altre modifiche restano ammesse.
      const altro = await nel(a.tenantId, () =>
        registri.modifica(a.tenantId, a.utenteId, a.registroId, {
          descrizione: 'Altra',
          versione: 1,
        })
      )
      expect(altro.versione).toBe(2)
    })

    it('con definitivi solo dell`anno prima (e una BOZZA dell`anno corrente): 200', async () => {
      const a = await azienda()
      await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: a.registroId,
        anno: ANNO - 1,
      })
      await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'BOZZA',
        registroIvaId: a.registroId,
        anno: ANNO,
      })
      const lista = await nel(a.tenantId, () => registri.list(a.tenantId, true))
      expect(lista[0].suffissoModificabile).toBe(true)
      const v = await modifica(a, a.registroId, '/A', 1)
      expect(v.suffissoNumero).toBe('/A')
    })

    describe('barriera sul lock della numerazione della coppia dell`anno', () => {
      const inAttesa = async () => {
        const r = await owner.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
            AND wait_event_type = 'Lock'`
        return r[0].n
      }
      const finche = async (attesi: number) => {
        const scadenza = Date.now() + 30_000
        while ((await inAttesa()) < attesi) {
          if (Date.now() > scadenza) throw new Error(`sessioni in attesa di lock: attese ${attesi}`)
          await new Promise(r => setTimeout(r, 25))
        }
      }
      /** Una riserva che tiene il lock della coppia finche` non si chiama `rilascia`. */
      function riservaAperta(tenantId: string, registroIvaId: string, rollback: boolean) {
        let rilascia!: () => void
        const fine = new Promise<void>(r => (rilascia = r))
        let presa!: () => void
        const tenuta = new Promise<void>(r => (presa = r))
        const esito = nel(tenantId, () =>
          app.$transaction(
            async tx => {
              await riservaNumeri(tx, tenantId, [
                { registroIvaId, anno: ANNO, quanti: 1, dataDocumento: `${ANNO}-01-02` },
              ])
              presa()
              await fine
              if (rollback) throw new Error('rollback voluto dal test')
            },
            { timeout: 60_000, maxWait: 30_000 }
          )
        )
        esito.catch(() => undefined)
        return { esito, tenuta, rilascia }
      }

      it('cambio di suffisso contro una riserva aperta: aspetta, poi 409 se la riserva e` diventata un definitivo', async () => {
        const a = await azienda()
        const r = riservaAperta(a.tenantId, a.registroId, false)
        await r.tenuta
        const cambio = modifica(a, a.registroId, '/A', 1)
        const esito = cambio.then(
          v => ({ v }),
          (e: unknown) => ({ e })
        )
        await finche(1)
        // La riserva si conclude con un definitivo (nella realta` lo scrive la stessa transazione).
        await creaDocumentoDiTest(owner, a.tenantId, {
          stato: 'DEFINITIVO',
          registroIvaId: a.registroId,
          anno: ANNO,
        })
        r.rilascia()
        await r.esito
        const risultato: any = await esito
        expect(codiceErrore(risultato.e)).toBe('SUFFISSO_NON_MODIFICABILE')
        const riga = await owner.registroIva.findUniqueOrThrow({ where: { id: a.registroId } })
        expect(riga.suffissoNumero).toBeNull()
      })

      it('riserva annullata (rollback): il cambio aspetta e poi riesce', async () => {
        const a = await azienda()
        const r = riservaAperta(a.tenantId, a.registroId, true)
        await r.tenuta
        const cambio = modifica(a, a.registroId, '/A', 1)
        const esito = cambio.then(
          v => ({ v }),
          (e: unknown) => ({ e })
        )
        await finche(1)
        r.rilascia()
        await r.esito.catch(() => undefined)
        const risultato: any = await esito
        expect(risultato.e).toBeUndefined()
        expect(risultato.v.suffissoNumero).toBe('/A')
      })
    })

    it('una riserva fatta dopo il cambio legge il suffisso nuovo', async () => {
      const a = await azienda()
      await modifica(a, a.registroId, '/Z', 1)
      const riservati = await nel(a.tenantId, () =>
        app.$transaction(
          tx =>
            riservaNumeri(tx, a.tenantId, [
              {
                registroIvaId: a.registroId,
                anno: ANNO,
                quanti: 1,
                dataDocumento: `${ANNO}-01-02`,
              },
            ]),
          OPZIONI_TRANSAZIONE_SCRITTURA
        )
      )
      expect(riservati[0].suffisso).toBe('/Z')
    })
  })

  // -----------------------------------------------------------------------------------------
  describe('«in uso» da un documento', () => {
    /** Riga di documento (in una bozza) che cita una riga di listino e/o un codice IVA. */
    async function inserisciRigaDocumento(
      tenantId: string,
      documentoId: string,
      linea: number,
      rigaAddebitoId: string | null,
      codiceIvaId: string
    ): Promise<string> {
      const [r] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO righe_documento_fattura
           (tenant_id, documento_id, numero_linea, tipo_riga, riga_addebito_id, descrizione,
            prezzo_unitario, importo_lordo, importo_sconto, prezzo_totale, codice_iva_id,
            aliquota_iva, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::int, 'FISSO', $4::uuid, 'Riga di prova', 1, 1, 0, 1,
            $5::uuid, 22, now())
         RETURNING id::text AS id`,
        tenantId,
        documentoId,
        linea,
        rigaAddebitoId,
        codiceIvaId
      )
      return r.id
    }

    it('riga di listino citata da una riga di documento: eliminabile false, delete 409 RIGA_ADDEBITO_IN_USO', async () => {
      const a = await azienda()
      const c = await creaContrattoConElenco(owner, a.tenantId)
      const riga = await creaRiga(owner, a.tenantId, c.elencoId, {
        tipo: 'F',
        codiceIvaId: a.iva22Id,
        prezzo: '10',
      })
      const libera = await creaRiga(owner, a.tenantId, c.elencoId, {
        tipo: 'F',
        codiceIvaId: a.iva22Id,
        prezzo: '10',
      })
      const { documentoId } = await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'BOZZA',
        registroIvaId: a.registroId,
        anno: ANNO,
      })
      await inserisciRigaDocumento(a.tenantId, documentoId, 1, riga.id, a.iva22Id)
      const lista = await nel(a.tenantId, () => righe.list(a.tenantId, c.elencoId))
      expect(lista.find(r => r.id === riga.id)?.eliminabile).toBe(false)
      expect(lista.find(r => r.id === libera.id)?.eliminabile).toBe(true)
      const dbRiga = await owner.rigaAddebito.findUniqueOrThrow({ where: { id: riga.id } })
      const e = await errore(
        nel(a.tenantId, () => righe.elimina(a.tenantId, a.utenteId, riga.id, dbRiga.versione))
      )
      expect(stato(e)).toBe(409)
      expect(codiceErrore(e)).toBe('RIGA_ADDEBITO_IN_USO')
    })

    it('riga di listino citata solo da un marcatore: eliminabile false, delete 409 RIGA_ADDEBITO_IN_USO', async () => {
      const a = await azienda()
      const c = await creaContrattoConElenco(owner, a.tenantId)
      const riga = await creaRiga(owner, a.tenantId, c.elencoId, {
        tipo: 'F',
        codiceIvaId: a.iva22Id,
        prezzo: '10',
      })
      const { documentoId } = await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'BOZZA',
        registroIvaId: a.registroId,
        anno: ANNO,
      })
      // La riga del documento NON cita la riga di listino: solo il marcatore lo fa.
      const rigaDocId = await inserisciRigaDocumento(a.tenantId, documentoId, 1, null, a.iva22Id)
      await owner.$executeRawUnsafe(
        `INSERT INTO marcatori_addebiti_fatturati
           (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
         VALUES ($1::uuid, $2::uuid, 'SCADENZA_FISSO', '2026-03-01', $3::uuid, $4::uuid)`,
        a.tenantId,
        riga.id,
        documentoId,
        rigaDocId
      )
      const lista = await nel(a.tenantId, () => righe.list(a.tenantId, c.elencoId))
      expect(lista.find(r => r.id === riga.id)?.eliminabile).toBe(false)
      const dbRiga = await owner.rigaAddebito.findUniqueOrThrow({ where: { id: riga.id } })
      const e = await errore(
        nel(a.tenantId, () => righe.elimina(a.tenantId, a.utenteId, riga.id, dbRiga.versione))
      )
      expect(stato(e)).toBe(409)
      expect(codiceErrore(e)).toBe('RIGA_ADDEBITO_IN_USO')
    })

    it('codice IVA citato da una riga di documento: CODICE_IVA_IN_USO', async () => {
      const a = await azienda()
      const { documentoId } = await creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'BOZZA',
        registroIvaId: a.registroId,
        anno: ANNO,
      })
      await inserisciRigaDocumento(a.tenantId, documentoId, 1, null, a.ivaN61Id)
      const lista = await nel(a.tenantId, () => codiciIva.list(a.tenantId, true))
      expect(lista.find(c => c.id === a.ivaN61Id)?.eliminabile).toBe(false)
      const riga = await owner.codiceIva.findUniqueOrThrow({ where: { id: a.ivaN61Id } })
      const e = await errore(
        nel(a.tenantId, () => codiciIva.elimina(a.tenantId, a.utenteId, a.ivaN61Id, riga.versione))
      )
      expect(stato(e)).toBe(409)
      expect(codiceErrore(e)).toBe('CODICE_IVA_IN_USO')
    })

    describe('registro IVA', () => {
      const provaNonEliminabile = async (
        a: { tenantId: string; utenteId: string },
        registroId: string
      ) => {
        const lista = await nel(a.tenantId, () => registri.list(a.tenantId, true))
        expect(lista.find(r => r.id === registroId)?.eliminabile).toBe(false)
        const riga = await owner.registroIva.findUniqueOrThrow({ where: { id: registroId } })
        const e = await errore(
          nel(a.tenantId, () => registri.elimina(a.tenantId, a.utenteId, registroId, riga.versione))
        )
        expect(stato(e)).toBe(409)
        expect(codiceErrore(e)).toBe('REGISTRO_IVA_IN_USO')
      }

      it('citato da un documento', async () => {
        const a = await azienda()
        const altro = await owner.registroIva.create({
          data: { tenantId: a.tenantId, codice: '05', descrizione: 'Altro' },
        })
        await creaDocumentoDiTest(owner, a.tenantId, {
          stato: 'BOZZA',
          registroIvaId: altro.id,
          anno: ANNO,
        })
        await provaNonEliminabile(a, altro.id)
      })

      it('citato da una numerazione', async () => {
        const a = await azienda()
        const altro = await owner.registroIva.create({
          data: { tenantId: a.tenantId, codice: '06', descrizione: 'Altro' },
        })
        await owner.numerazioneFattura.create({
          data: { tenantId: a.tenantId, registroIvaId: altro.id, anno: ANNO },
        })
        await provaNonEliminabile(a, altro.id)
      })

      it('citato dal cedente come predefinito', async () => {
        const a = await azienda()
        const altro = await owner.registroIva.create({
          data: { tenantId: a.tenantId, codice: '07', descrizione: 'Altro' },
        })
        await creaCedenteDiTest(owner, a.tenantId)
        await owner.cedenteFatturazione.update({
          where: { tenantId: a.tenantId },
          data: { registroIvaPredefinitoId: altro.id },
        })
        await provaNonEliminabile(a, altro.id)
      })

      it('non citato da nulla: eliminabile', async () => {
        const a = await azienda()
        const libero = await owner.registroIva.create({
          data: { tenantId: a.tenantId, codice: '08', descrizione: 'Libero' },
        })
        const lista = await nel(a.tenantId, () => registri.list(a.tenantId, true))
        expect(lista.find(r => r.id === libero.id)?.eliminabile).toBe(true)
      })
    })

    describe('cliente, contratto ed elenco citati da un documento: 409, mai 500', () => {
      async function conDocumento() {
        const a = await azienda()
        const { documentoId } = await creaDocumentoDiTest(owner, a.tenantId, {
          stato: 'BOZZA',
          registroIvaId: a.registroId,
          anno: ANNO,
        })
        const [d] = await owner.$queryRawUnsafe<{ cliente_id: string; contratto_id: string }[]>(
          `SELECT cliente_id::text, contratto_id::text FROM documenti_fattura WHERE id = $1::uuid`,
          documentoId
        )
        const elenco = await owner.elencoAddebiti.findFirstOrThrow({
          where: { contrattoId: d.contratto_id },
        })
        return { a, documentoId, clienteId: d.cliente_id, contrattoId: d.contratto_id, elenco }
      }

      it('cliente del documento: CLIENTE_CON_CONTRATTI', async () => {
        const { a, clienteId } = await conDocumento()
        const riga = await owner.cliente.findUniqueOrThrow({ where: { id: clienteId } })
        const e = await errore(
          nel(a.tenantId, () => clienti.elimina(a.tenantId, a.utenteId, clienteId, riga.versione))
        )
        expect(stato(e)).toBe(409)
        expect(codiceErrore(e)).toBe('CLIENTE_CON_CONTRATTI')
      })

      it('cliente solo intestatario della fattura, senza contratti propri: CLIENTE_CON_CONTRATTI', async () => {
        const { a, documentoId } = await conDocumento()
        const intestatario = (await creaDittaConRuolo(owner, a.tenantId, 'CLIENTE')).ruoloId
        await owner.$executeRawUnsafe(
          `UPDATE documenti_fattura SET cliente_fatturazione_id = $2::uuid WHERE id = $1::uuid`,
          documentoId,
          intestatario
        )
        const riga = await owner.cliente.findUniqueOrThrow({ where: { id: intestatario } })
        const e = await errore(
          nel(a.tenantId, () =>
            clienti.elimina(a.tenantId, a.utenteId, intestatario, riga.versione)
          )
        )
        expect(stato(e)).toBe(409)
        expect(codiceErrore(e)).toBe('CLIENTE_CON_CONTRATTI')
      })

      it('contratto del documento (anche se in bozza): CONTRATTO_CLIENTE_NON_ELIMINABILE', async () => {
        const { a, contrattoId } = await conDocumento()
        await owner.contrattoCliente.update({
          where: { id: contrattoId },
          data: { stato: 'BOZZA' },
        })
        const riga = await owner.contrattoCliente.findUniqueOrThrow({ where: { id: contrattoId } })
        const e = await errore(
          nel(a.tenantId, () =>
            contratti.elimina(a.tenantId, a.utenteId, contrattoId, riga.versione)
          )
        )
        expect(stato(e)).toBe(409)
        expect(codiceErrore(e)).toBe('CONTRATTO_CLIENTE_NON_ELIMINABILE')
        const dopo = await owner.contrattoCliente.findUniqueOrThrow({ where: { id: contrattoId } })
        expect(dopo.eliminatoIl).toBeNull()
      })

      it('contratto senza documenti ma in bozza: si elimina come prima', async () => {
        const a = await azienda()
        const c = await creaContrattoConElenco(owner, a.tenantId, { stato: 'BOZZA' })
        const riga = await owner.contrattoCliente.findUniqueOrThrow({
          where: { id: c.contrattoId },
        })
        await nel(a.tenantId, () =>
          contratti.elimina(a.tenantId, a.utenteId, c.contrattoId, riga.versione)
        )
        const dopo = await owner.contrattoCliente.findUniqueOrThrow({
          where: { id: c.contrattoId },
        })
        expect(dopo.eliminatoIl).not.toBeNull()
      })

      it('elenco del documento: ELENCO_ADDEBITI_IN_USO', async () => {
        const { a, documentoId, elenco } = await conDocumento()
        await owner.$executeRawUnsafe(
          `UPDATE documenti_fattura SET elenco_id = $2::uuid WHERE id = $1::uuid`,
          documentoId,
          elenco.id
        )
        const e = await errore(
          nel(a.tenantId, () => elenchi.elimina(a.tenantId, a.utenteId, elenco.id, elenco.versione))
        )
        expect(stato(e)).toBe(409)
        expect(codiceErrore(e)).toBe('ELENCO_ADDEBITI_IN_USO')
        expect(await owner.elencoAddebiti.count({ where: { id: elenco.id } })).toBe(1)
      })
    })
  })
})
