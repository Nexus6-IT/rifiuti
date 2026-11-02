// Azioni sul listino di un contratto (4.2b, Task 23; D18, D19, D17, R40, R45, R60): copia di elenchi
// e di righe, provvigione e sconto su tutte le righe di un contratto. Le regole sulla scelta delle
// righe da copiare stanno in `domain/listino/copia-righe`, quelle sui dati della riga in
// `domain/listino/riga-addebito`; qui ci sono i lock e la scrittura.
//
// Ordine dei lock (R40): contratto di arrivo FOR SHARE (stato D16, allegato D17) -> lock consultivo
// per contratto (`listino-contratto`, lo stesso di `ElenchiAddebitiService` e `RigheAddebitoService`)
// -> elenchi FOR UPDATE IN ORDINE DI id (quello di arrivo e quelli di partenza, anche di altri
// contratti: due copie incrociate A<-B e B<-A non si incrociano sui lock) . Il contratto di
// partenza e' letto solo per "non eliminato": la copia non lo modifica. Le azioni non cambiano la
// `versione` del contratto (D16); cambiano quella dell'elenco di arrivo e delle righe toccate.
//
// Le righe copiate NON passano da `preparaDati` del servizio delle righe (che legge il catalogo CER
// e controlla i riferimenti come nuovi): sono righe gia' valide nel database. Pero' ciascuna e'
// riconvalidata con `normalizzaRiga` + `validaRiga` per il contratto di arrivo, perche' una regola
// dipende dal contratto: D17 (un contratto allegato ammette solo i tipi `T…`). Se una riga non e'
// valida, la copia intera risponde 400 con `details.errori` (R60): mai una copia a meta'.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { scegliRigheDaCopiare, type EscluseCopia } from '../../domain/listino/copia-righe'
import {
  cascataValida,
  MESSAGGIO_CASCATA,
  normalizzaCascata,
} from '../../domain/listino/importi-riga'
import { normalizzaRiga, validaRiga } from '../../domain/listino/riga-addebito'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  bloccaContrattoListino,
  impostaTimeoutLock,
  lockConsultivoContratto,
  type ContrattoBloccato,
} from './lock-listino'
import { grezzoDaRiga } from './righe-addebito.service'

/** R45. */
export interface EsitoCopia {
  copiate: number
  escluse: EscluseCopia
  /**
   * Una riga per riga copiata che punta a un addebito, un codice IVA o una codifica (categoria,
   * centro di ricavo) disattivati nell'archivio (M11, decisione di Graziano): la copia le include
   * lo stesso e le segnala. Vuoto se non ce ne sono.
   */
  avvisi: string[]
}

export interface EsitoImpostazione {
  /** Righe cambiate davvero (la loro `versione` sale di uno). */
  aggiornate: number
  /** Righe con il prezzo speciale: non si toccano, vanno sistemate a mano (D19). */
  speciali: number
  /** Righe che per il loro tipo non hanno il campo (la provvigione dei `$D` e `$R`). */
  escluse: number
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'ELENCO_ADDEBITI',
  soggetto: "L'elenco degli addebiti",
  femminile: false,
}

/** Race improbabile (i duplicati sono scartati sotto lock): l'indice unico della riga. */
const VINCOLI: VincoliNoti = {
  righe_addebito_elenco_tipo_cer_addebito_rif_key: {
    codice: 'RIGA_ADDEBITO_DUPLICATA',
    messaggio: 'L’addebito è già nell’elenco con lo stesso riferimento.',
  },
}

/** Una transazione sola su molte righe: piu' tempo del default di Prisma (5 s). */
const OPZIONI_TRANSAZIONE = { timeout: 30_000, maxWait: 5_000 } as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ERRORI = 20
const BLOCCO_AGGIORNAMENTO = 5_000

const CODICE_COPIA = 'COPIA_ELENCO_NON_VALIDA'
const CODICE_IMPOSTAZIONE = 'IMPOSTAZIONE_CONTRATTO_NON_VALIDA'
const MSG_SU_SE_STESSO = 'Un elenco non si copia su sé stesso.'
const MSG_TIPO_PROVVIGIONE = 'Indica su cosa si calcola la provvigione.'

const contrattoNonTrovato = () =>
  new NotFoundException({
    message: 'Contratto non trovato.',
    error: 'CONTRATTO_CLIENTE_NON_TROVATO',
  })

const elencoNonTrovato = () =>
  new NotFoundException({
    message: 'Elenco degli addebiti non trovato.',
    error: 'ELENCO_ADDEBITI_NON_TROVATO',
  })

const rigaNonTrovata = () =>
  new NotFoundException({
    message: 'Riga di addebito non trovata.',
    error: 'RIGA_ADDEBITO_NON_TROVATA',
  })

/** R60: il filtro globale inoltra al client solo `error`, `message` e `details`. */
function nonValido(codice: string, errori: readonly ErroreAzione[]): never {
  throw new BadRequestException({
    error: codice,
    message: errori.map(e => e.messaggio),
    errori,
    details: { errori },
  })
}

/** Errore con il campo del corpo a cui si riferisce (`null` = regola generale). */
export interface ErroreAzione {
  campo: string | null
  messaggio: string
}

const campoNullo = (messaggio: string): ErroreAzione => ({ campo: null, messaggio })

const RIGA_CON_FIGLI = {
  addebito: { select: { codice: true } },
  scaglioni: { orderBy: { ordine: 'asc' } },
  scadenze: { orderBy: { ordine: 'asc' } },
} satisfies Prisma.RigaAddebitoInclude

type RigaConFigli = Prisma.RigaAddebitoGetPayload<{ include: typeof RIGA_CON_FIGLI }>

const COLONNE_REGOLE = {
  tipo: true,
  cerCode: true,
  addebitoId: true,
  riferimento: true,
  unitaMisura: true,
  condizione: true,
  condizioniRiferite: true,
  applicaA: true,
} satisfies Prisma.RigaAddebitoSelect

/**
 * La `versione` dell'ELENCO sale con l'intestazione e con le copie (sostituisci-da, aggiungi-righe),
 * non con provvigioni e sconti: lì ogni riga toccata alza la propria `versione`, e chi la teneva
 * aperta riceve 409. Nemmeno le scritture di una singola riga (Task 21) cambiano quella dell'elenco.
 */
@Injectable()
export class AzioniListinoService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------------------------
  // Copia di elenchi e righe (D18)
  // -------------------------------------------------------------------------------------------

  /** Sostituisce le righe dell'elenco con copie di quelle di un altro elenco della stessa azienda. */
  async sostituisciDa(
    tenantId: string,
    utenteId: string,
    elencoId: string,
    corpo: { daElencoId: string; versione: number }
  ): Promise<EsitoCopia> {
    if (!UUID.test(elencoId) || !UUID.test(corpo.daElencoId)) throw elencoNonTrovato()
    const daElencoId = corpo.daElencoId.toLowerCase()
    elencoId = elencoId.toLowerCase()
    if (daElencoId === elencoId) nonValido(CODICE_COPIA, [campoNullo(MSG_SU_SE_STESSO)])

    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const arrivo = await this.elencoVisibile(tx, tenantId, elencoId)
          await this.elencoVisibile(tx, tenantId, daElencoId)
          const contratto = await bloccaContrattoListino(tx, tenantId, arrivo.contrattoId)
          await lockConsultivoContratto(tx, contratto.id)
          await this.bloccaElenchi(tx, tenantId, [elencoId, daElencoId])
          const dopoLock = await tx.elencoAddebiti.findFirst({
            where: { id: elencoId, tenantId },
            select: { versione: true, codice: true },
          })
          if (!dopoLock) throw elencoNonTrovato()
          confrontaVersione(dopoLock.versione, corpo.versione, ENTITA)

          const candidate = await tx.rigaAddebito.findMany({
            where: { tenantId, elencoId: daElencoId },
            include: RIGA_CON_FIGLI,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
          const { scelte, escluse } = scegliRigheDaCopiare(candidate, [])
          this.controllaDominio(scelte, contratto)

          // Righe bloccate in ordine di id prima di cancellarle (m2): niente cicli con la variazione.
          await this.bloccaRighe(tx, tenantId, {
            elencoId,
          })
          await tx.rigaAddebito.deleteMany({ where: { tenantId, elencoId } })
          await this.scrivi(tx, tenantId, elencoId, scelte)
          await this.alzaVersione(tx, tenantId, elencoId, corpo.versione)
          const esito: EsitoCopia = {
            copiate: scelte.length,
            escluse,
            avvisi: await this.avvisiRiferimenti(tx, tenantId, scelte),
          }
          await this.audit(tx, tenantId, utenteId, 'RIGHE_ADDEBITO_ELENCO_SOSTITUITE', {
            modo: 'sostituisci',
            elencoId,
            codiceElenco: dopoLock.codice,
            daElencoId,
            contrattoId: contratto.id,
            numeroContratto: contratto.numero,
            ...esito.escluse,
            copiate: esito.copiate,
            conRiferimentiDisattivati: esito.avvisi.length,
          })
          return esito
        }, OPZIONI_TRANSAZIONE)
      } catch (err) {
        return await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  /** Aggiunge all'elenco copie delle righe scelte (di qualunque elenco della stessa azienda). */
  async aggiungiRighe(
    tenantId: string,
    utenteId: string,
    elencoId: string,
    corpo: { righeIds: string[]; versione: number }
  ): Promise<EsitoCopia> {
    if (!UUID.test(elencoId)) throw elencoNonTrovato()
    if (corpo.righeIds.some(i => !UUID.test(i))) throw rigaNonTrovata()
    elencoId = elencoId.toLowerCase()
    const ids = [...new Set(corpo.righeIds.map(i => i.toLowerCase()))]
    if (ids.length === 0) {
      nonValido(CODICE_COPIA, [campoNullo('Scegli almeno una riga da copiare.')])
    }

    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const arrivo = await this.elencoVisibile(tx, tenantId, elencoId)
          const note = await tx.rigaAddebito.findMany({
            where: { id: { in: ids }, tenantId, elenco: { contratto: { eliminatoIl: null } } },
            select: { elencoId: true },
          })
          // Una riga di un'altra azienda o di un contratto eliminato non esiste (404).
          if (note.length !== ids.length) throw rigaNonTrovata()
          const contratto = await bloccaContrattoListino(tx, tenantId, arrivo.contrattoId)
          await lockConsultivoContratto(tx, contratto.id)
          await this.bloccaElenchi(tx, tenantId, [elencoId, ...note.map(n => n.elencoId)])
          const dopoLock = await tx.elencoAddebiti.findFirst({
            where: { id: elencoId, tenantId },
            select: { versione: true, codice: true },
          })
          if (!dopoLock) throw elencoNonTrovato()
          confrontaVersione(dopoLock.versione, corpo.versione, ENTITA)

          // Riletta sotto lock: una riga eliminata nel frattempo non esiste piu'.
          const candidate = await tx.rigaAddebito.findMany({
            where: { id: { in: ids }, tenantId },
            include: RIGA_CON_FIGLI,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
          if (candidate.length !== ids.length) throw rigaNonTrovata()
          const esistenti = await tx.rigaAddebito.findMany({
            where: { tenantId, elencoId },
            select: COLONNE_REGOLE,
          })
          const { scelte, escluse } = scegliRigheDaCopiare(candidate, esistenti)
          this.controllaDominio(scelte, contratto)

          await this.scrivi(tx, tenantId, elencoId, scelte)
          await this.alzaVersione(tx, tenantId, elencoId, corpo.versione)
          const esito: EsitoCopia = {
            copiate: scelte.length,
            escluse,
            avvisi: await this.avvisiRiferimenti(tx, tenantId, scelte),
          }
          await this.audit(tx, tenantId, utenteId, 'RIGHE_ADDEBITO_COPIATE', {
            modo: 'aggiungi',
            elencoId,
            codiceElenco: dopoLock.codice,
            contrattoId: contratto.id,
            numeroContratto: contratto.numero,
            richieste: ids.length,
            ...esito.escluse,
            copiate: esito.copiate,
            conRiferimentiDisattivati: esito.avvisi.length,
          })
          return esito
        }, OPZIONI_TRANSAZIONE)
      } catch (err) {
        return await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  // -------------------------------------------------------------------------------------------
  // Provvigione e sconto su tutto il contratto (D19)
  // -------------------------------------------------------------------------------------------

  /**
   * Imposta provvigione e tipo su tutte le righe SENZA prezzo speciale. `provvigione` null o vuota
   * svuota provvigione e tipo (R45). Mai per `$D` e `$R` (escluse e contate); le speciali si
   * contano e non si toccano.
   */
  async impostaProvvigioni(
    tenantId: string,
    utenteId: string,
    contrattoId: string,
    corpo: { provvigione?: unknown; tipoProvvigione?: unknown }
  ): Promise<EsitoImpostazione> {
    if (!UUID.test(contrattoId)) throw contrattoNonTrovato()
    const errori: ErroreAzione[] = []
    if (corpo.provvigione === undefined) {
      errori.push({
        campo: 'provvigione',
        messaggio: 'Indica la provvigione, o lasciala vuota per svuotarla.',
      })
    }
    const provvigione = normalizzaCascata(corpo.provvigione)
    const tipoScritto =
      typeof corpo.tipoProvvigione === 'string' ? corpo.tipoProvvigione.trim().toUpperCase() : ''
    let tipo: 'SCONTATO' | 'LORDO' | null = null
    if (provvigione !== null) {
      if (!cascataValida(provvigione) || provvigione.length > 20) {
        errori.push({ campo: 'provvigione', messaggio: MESSAGGIO_CASCATA })
      }
      if (tipoScritto === 'SCONTATO' || tipoScritto === 'LORDO') tipo = tipoScritto
      else errori.push({ campo: 'tipoProvvigione', messaggio: MSG_TIPO_PROVVIGIONE })
    }
    if (errori.length > 0) nonValido(CODICE_IMPOSTAZIONE, errori)

    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const contratto = await bloccaContrattoListino(tx, tenantId, contrattoId)
          await lockConsultivoContratto(tx, contratto.id)
          await this.bloccaElenchiDelContratto(tx, tenantId, contratto.id)
          const righe = await tx.rigaAddebito.findMany({
            where: { tenantId, elenco: { contrattoId: contratto.id } },
            select: {
              id: true,
              tipo: true,
              prezzoSpeciale: true,
              provvigione: true,
              tipoProvvigione: true,
            },
          })
          let speciali = 0
          let escluse = 0
          const daCambiare: string[] = []
          for (const r of righe) {
            if (r.prezzoSpeciale) speciali++
            else if (r.tipo === '$D' || r.tipo === '$R') escluse++
            else if (r.provvigione !== provvigione || r.tipoProvvigione !== tipo)
              daCambiare.push(r.id)
          }
          await this.aggiornaRighe(tx, tenantId, daCambiare, {
            provvigione,
            tipoProvvigione: tipo,
          })
          const esito: EsitoImpostazione = { aggiornate: daCambiare.length, speciali, escluse }
          await this.audit(tx, tenantId, utenteId, 'PROVVIGIONI_CONTRATTO_IMPOSTATE', {
            contrattoId: contratto.id,
            numeroContratto: contratto.numero,
            provvigione,
            tipoProvvigione: tipo,
            ...esito,
          })
          return esito
        }, OPZIONI_TRANSAZIONE)
      } catch (err) {
        return await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  /**
   * Sostituisce lo sconto nelle righe SENZA prezzo speciale che hanno esattamente `scontoAttuale`
   * (formula normalizzata: "10 + 5" e "10+5" sono lo stesso sconto). `scontoNuovo` e' obbligatorio
   * (WinWaste: "Specificare entrambi gli sconti"). Le righe speciali che portano lo sconto attuale (sulla riga o in una fascia) non si
   * toccano e si contano: vanno sistemate a mano.
   */
  async sostituisciSconto(
    tenantId: string,
    utenteId: string,
    contrattoId: string,
    corpo: { scontoAttuale?: unknown; scontoNuovo?: unknown }
  ): Promise<EsitoImpostazione> {
    if (!UUID.test(contrattoId)) throw contrattoNonTrovato()
    const errori: ErroreAzione[] = []
    const attuale = normalizzaCascata(corpo.scontoAttuale)
    const nuovo = normalizzaCascata(corpo.scontoNuovo)
    if (attuale === null) {
      errori.push({ campo: 'scontoAttuale', messaggio: 'Indica lo sconto da sostituire.' })
    } else if (!cascataValida(attuale) || attuale.length > 20) {
      errori.push({ campo: 'scontoAttuale', messaggio: MESSAGGIO_CASCATA })
    }
    if (nuovo === null) {
      // WinWaste (IMPOSTAP.cs:530-534): la sostituzione vuole entrambi gli sconti.
      errori.push({ campo: 'scontoNuovo', messaggio: 'Specificare entrambi gli sconti.' })
    } else if (!cascataValida(nuovo) || nuovo.length > 20) {
      errori.push({ campo: 'scontoNuovo', messaggio: MESSAGGIO_CASCATA })
    }
    if (errori.length > 0) nonValido(CODICE_IMPOSTAZIONE, errori)

    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const contratto = await bloccaContrattoListino(tx, tenantId, contrattoId)
          await lockConsultivoContratto(tx, contratto.id)
          await this.bloccaElenchiDelContratto(tx, tenantId, contratto.id)
          const righe = await tx.rigaAddebito.findMany({
            where: {
              tenantId,
              elenco: { contrattoId: contratto.id },
              OR: [{ sconto: { not: null } }, { prezzoSpeciale: true }],
            },
            select: {
              id: true,
              prezzoSpeciale: true,
              sconto: true,
              scaglioni: { select: { sconto: true } },
            },
          })
          const uguale = (s: string | null) => normalizzaCascata(s) === attuale
          let speciali = 0
          const daCambiare: string[] = []
          for (const r of righe) {
            if (r.prezzoSpeciale) {
              if (uguale(r.sconto) || r.scaglioni.some(s => uguale(s.sconto))) speciali++
            } else if (uguale(r.sconto) && attuale !== nuovo) daCambiare.push(r.id)
          }
          await this.aggiornaRighe(tx, tenantId, daCambiare, { sconto: nuovo })
          const esito: EsitoImpostazione = { aggiornate: daCambiare.length, speciali, escluse: 0 }
          await this.audit(tx, tenantId, utenteId, 'SCONTI_CONTRATTO_SOSTITUITI', {
            contrattoId: contratto.id,
            numeroContratto: contratto.numero,
            scontoAttuale: attuale,
            scontoNuovo: nuovo,
            ...esito,
          })
          return esito
        }, OPZIONI_TRANSAZIONE)
      } catch (err) {
        return await traduciErrorePrisma(err, ENTITA, VINCOLI)
      }
    })
  }

  // -------------------------------------------------------------------------------------------
  // Dominio, scrittura
  // -------------------------------------------------------------------------------------------

  /**
   * Ogni riga da copiare e' riconvalidata per il contratto di arrivo (D17 e regole sui dati). Una
   * riga non valida fa rispondere 400 a tutta la copia, con i messaggi preceduti dalla riga.
   */
  private controllaDominio(scelte: readonly RigaConFigli[], contratto: ContrattoBloccato): void {
    const errori: ErroreAzione[] = []
    for (const r of scelte) {
      const { dati, errori: eNorm } = normalizzaRiga(grezzoDaRiga(r), new Set())
      const eRiga = [
        ...eNorm,
        ...validaRiga(dati, { contrattoAllegato: contratto.contrattoPrincipaleId !== null }),
      ]
      const nome = [r.tipo, r.cerCode ?? r.addebito?.codice, r.riferimento]
        .filter((x): x is string => !!x)
        .join(' ')
      for (const e of eRiga) errori.push(campoNullo(`Riga ${nome}: ${e.messaggio}`))
    }
    if (errori.length === 0) return
    const resto = errori.length - MAX_ERRORI
    nonValido(CODICE_COPIA, [
      ...errori.slice(0, MAX_ERRORI),
      ...(resto > 0 ? [campoNullo(`E altri ${resto} errori.`)] : []),
    ])
  }

  /** Crea le copie (nuovi id, versione 1) con fasce e scadenze, nell'ordine di arrivo. */
  private async scrivi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    elencoId: string,
    righe: readonly RigaConFigli[]
  ): Promise<void> {
    for (const r of righe) {
      const {
        id: _id,
        elencoId: _elenco,
        versione: _versione,
        createdAt: _creata,
        updatedAt: _aggiornata,
        addebito: _addebito,
        scaglioni,
        scadenze,
        ...scalari
      } = r
      const creata = await tx.rigaAddebito.create({
        data: { ...scalari, tenantId, elencoId },
        select: { id: true },
      })
      if (scaglioni.length > 0) {
        await tx.scaglioneRigaAddebito.createMany({
          data: scaglioni.map(s => ({
            tenantId,
            rigaId: creata.id,
            ordine: s.ordine,
            finoA: s.finoA,
            prezzo: s.prezzo,
            sconto: s.sconto,
            provvigione: s.provvigione,
            tipoCalcolo: s.tipoCalcolo,
          })),
        })
      }
      if (scadenze.length > 0) {
        await tx.scadenzaRigaAddebito.createMany({
          data: scadenze.map(s => ({
            tenantId,
            rigaId: creata.id,
            ordine: s.ordine,
            giorno: s.giorno,
            mese: s.mese,
            anno: s.anno,
          })),
        })
      }
    }
  }

  /**
   * M11: le righe copiate i cui riferimenti sono stati disattivati nell'archivio si copiano comunque
   * (le FK reggono); qui si costruisce un avviso per riga, nell'ordine di copia. Una sola lettura
   * per tabella.
   */
  private async avvisiRiferimenti(
    tx: Prisma.TransactionClient,
    tenantId: string,
    scelte: readonly RigaConFigli[]
  ): Promise<string[]> {
    if (scelte.length === 0) return []
    const unici = (valori: (string | null)[]) => [
      ...new Set(valori.filter((v): v is string => v !== null)),
    ]
    const [addebiti, codiciIva, codifiche] = await Promise.all([
      tx.addebito.findMany({
        where: { tenantId, attivo: false, id: { in: unici(scelte.map(r => r.addebitoId)) } },
        select: { id: true, codice: true },
      }),
      tx.codiceIva.findMany({
        where: { tenantId, attivo: false, id: { in: unici(scelte.map(r => r.codiceIvaId)) } },
        select: { id: true, codice: true },
      }),
      tx.codificaAddebito.findMany({
        where: {
          tenantId,
          attiva: false,
          id: { in: unici(scelte.flatMap(r => [r.categoriaId, r.centroRicavoId])) },
        },
        select: { id: true, codice: true },
      }),
    ])
    const addebitoDi = new Map(addebiti.map(a => [a.id, a.codice]))
    const ivaDi = new Map(codiciIva.map(c => [c.id, c.codice]))
    const codificaDi = new Map(codifiche.map(c => [c.id, c]))
    const avvisi: string[] = []
    for (const r of scelte) {
      const motivi: string[] = []
      if (r.addebitoId && addebitoDi.has(r.addebitoId)) {
        motivi.push(`l'addebito ${addebitoDi.get(r.addebitoId)} è disattivato nell'archivio`)
      }
      if (ivaDi.has(r.codiceIvaId)) {
        motivi.push(`il codice IVA ${ivaDi.get(r.codiceIvaId)} è disattivato nell'archivio`)
      }
      const categoria = r.categoriaId ? codificaDi.get(r.categoriaId) : undefined
      if (categoria) motivi.push(`la categoria ${categoria.codice} è disattivata nell'archivio`)
      const centro = r.centroRicavoId ? codificaDi.get(r.centroRicavoId) : undefined
      if (centro) motivi.push(`il centro di ricavo ${centro.codice} è disattivato nell'archivio`)
      if (motivi.length === 0) continue
      const nome =
        r.tipo === 'CER'
          ? `Riga CER ${r.cerCode ?? ''}`.trimEnd()
          : `Riga ${r.tipo}${r.addebito?.codice ? ` ${r.addebito.codice}` : ''}`
      avvisi.push(`${nome}: ${motivi.join('; ')}.`)
    }
    return avvisi
  }

  /** L'elenco di arrivo e' cambiato: chi lo teneva aperto con la versione vecchia avra' un 409. */
  private async alzaVersione(
    tx: Prisma.TransactionClient,
    tenantId: string,
    elencoId: string,
    versione: number
  ): Promise<void> {
    await scriviCondizionato(
      () =>
        tx.elencoAddebiti.updateMany({
          where: { id: elencoId, tenantId, versione },
          data: { versione: { increment: 1 } },
        }),
      ENTITA
    )
  }

  /**
   * Una sola UPDATE per riga (provvigione/sconto e `versione + 1` insieme): una seconda UPDATE
   * della stessa riga nella transazione rifarebbe il controllo della FK e prenderebbe `FOR KEY
   * SHARE` sull'elenco, in deadlock con `RigheAddebitoService.modifica`. Le righe si bloccano
   * prima, in ordine di id (m2).
   */
  private async aggiornaRighe(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: readonly string[],
    dati: Prisma.RigaAddebitoUncheckedUpdateManyInput
  ): Promise<void> {
    const ordinati = [...ids].sort()
    for (let i = 0; i < ordinati.length; i += BLOCCO_AGGIORNAMENTO) {
      const blocco = ordinati.slice(i, i + BLOCCO_AGGIORNAMENTO)
      await this.bloccaRighe(tx, tenantId, { ids: blocco })
      await tx.rigaAddebito.updateMany({
        where: { tenantId, id: { in: blocco } },
        data: { ...dati, versione: { increment: 1 } },
      })
    }
  }

  /** `SELECT … ORDER BY id FOR UPDATE` sulle righe di un elenco o su quelle indicate. */
  private async bloccaRighe(
    tx: Prisma.TransactionClient,
    tenantId: string,
    quali: { elencoId: string } | { ids: readonly string[] }
  ): Promise<void> {
    if ('elencoId' in quali) {
      await tx.$queryRaw`SELECT id FROM "righe_addebito"
        WHERE tenant_id = ${tenantId}::uuid AND elenco_id = ${quali.elencoId}::uuid
        ORDER BY id FOR UPDATE`
    } else {
      await tx.$queryRaw`SELECT id FROM "righe_addebito"
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${quali.ids as string[]}::uuid[])
        ORDER BY id FOR UPDATE`
    }
  }

  // -------------------------------------------------------------------------------------------
  // Lock (R40)
  // -------------------------------------------------------------------------------------------

  /** Elenco il cui contratto non e' eliminato; altrimenti 404 (anche per un'altra azienda). */
  private async elencoVisibile(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<{ contrattoId: string }> {
    const e = await tx.elencoAddebiti.findFirst({
      where: { id, tenantId, contratto: { eliminatoIl: null } },
      select: { contrattoId: true },
    })
    if (!e) throw elencoNonTrovato()
    return e
  }

  /** Elenchi FOR UPDATE uno alla volta, in ordine di id: nessun deadlock fra copie incrociate. */
  private async bloccaElenchi(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: readonly string[]
  ): Promise<void> {
    for (const id of [...new Set(ids.map(i => i.toLowerCase()))].sort()) {
      const r = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "elenchi_addebiti"
        WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`
      if (r.length === 0) throw elencoNonTrovato()
    }
  }

  /** Tutti gli elenchi del contratto FOR UPDATE, in ordine di id (poi si scrivono le righe). */
  private async bloccaElenchiDelContratto(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contrattoId: string
  ): Promise<void> {
    const elenchi = await tx.elencoAddebiti.findMany({
      where: { tenantId, contrattoId },
      select: { id: true },
    })
    await this.bloccaElenchi(
      tx,
      tenantId,
      elenchi.map(e => e.id)
    )
  }

  /** Audit nella stessa transazione (D25): id, numeri, codici e conteggi; mai testi liberi. */
  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    action: string,
    metadata: Record<string, string | number | null>
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action,
        description: 'Azione sul listino del contratto',
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
