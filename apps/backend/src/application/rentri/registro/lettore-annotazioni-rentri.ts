/**
 * Lettura delle annotazioni del registro da tradurre per RENTRI (D5).
 *
 * Ogni query gira nella transazione del chiamante (`tx`, con il contesto dell'azienda e quindi la
 * RLS) e ha `tenantId` esplicito nel `where`: nessuna query grezza. Il numero di query e' FISSO
 * (non dipende da quante annotazioni si leggono): movimenti, predecessori, catalogo delle
 * causali (2), FIR, produttori, destinatari, trasportatori, sedi, comuni, vigenti, aperture
 * (+ le loro origini).
 *
 * Legge TUTTE le righe richieste (ogni annotazione e' una registrazione RENTRI, anche se non piu'
 * vigente); per i riferimenti di carico (D6) usa invece le vigenti del registro piu' le aperture.
 */
import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { LoggerService } from '../../../core/logger/logger.service'
import { giornoItaliano } from '../../../core/time/anno-italiano'
import { WHERE_VIGENTE } from '../../../domain/waste-movement/vigenza'
import { millesimiFifo } from '../../../domain/waste-movement/fifo-deposito'
import { caricaCatalogoCausali } from '../../registro/causali/catalogo-causali.repository'
import { leggiApertureRegistro } from '../../registro/aperture-registro'
import type { IndirizzoRentri } from '../mappatura/mappa-parti'
import type {
  AnnotazionePerRentri,
  DatiFirPerRegistro,
  NumeroRegistrazione,
} from './mappa-registrazione-rentri'
import {
  riferimentiCaricoPerScarichi,
  type EventoPerRiferimenti,
} from './riferimenti-carico-rentri'

type Tx = Prisma.TransactionClient

interface SedeLetta {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}

const unici = <T>(valori: Array<T | null | undefined>): T[] => [
  ...new Set(valori.filter((v): v is T => v !== null && v !== undefined)),
]

@Injectable()
export class LettoreAnnotazioniRentri {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('LettoreAnnotazioniRentri')
  }

  /**
   * @param movimentoIds annotazioni da leggere, TUTTE del registro indicato e senza ripetizioni
   *   (lo garantisce il chiamante tramite `selezionaLotto`)
   * @throws Error (errore di programmazione) se una non esiste per l'azienda o e' di un altro registro
   */
  async leggi(
    tx: Tx,
    tenantId: string,
    registroId: string,
    movimentoIds: string[]
  ): Promise<AnnotazionePerRentri[]> {
    if (movimentoIds.length === 0) return []

    const righe = await tx.wasteMovement.findMany({
      where: { id: { in: movimentoIds }, tenantId },
    })
    const perId = new Map(righe.map(r => [r.id, r]))
    for (const id of new Set(movimentoIds)) {
      const r = perId.get(id)
      if (!r || r.registroId !== registroId) {
        throw new Error('Annotazione non trovata o di un altro registro: errore di programmazione')
      }
    }

    const predecessoriIds = unici(righe.map(r => r.movimentoRettificatoId))
    const firIds = unici(righe.map(r => r.firId))

    const [predecessori, catalogo, firs] = await Promise.all([
      predecessoriIds.length
        ? tx.wasteMovement.findMany({
            where: { id: { in: predecessoriIds }, tenantId },
            select: { id: true, progressiveYear: true, progressiveNumber: true },
          })
        : [],
      caricaCatalogoCausali(tx, tenantId),
      firIds.length ? tx.fIR.findMany({ where: { id: { in: firIds }, tenantId } }) : [],
    ])
    const numeroPredecessore = new Map(
      predecessori.map(p => [p.id, { anno: p.progressiveYear, progressivo: p.progressiveNumber }])
    )

    const firPerId = await this.costruisciFir(tx, tenantId, firs)
    const riferimenti = await this.riferimentiCarico(tx, tenantId, registroId, righe)

    return movimentoIds.map((id): AnnotazionePerRentri => {
      const r = perId.get(id)!
      const verso = r.type
      const giorno = giornoItaliano(r.movementDate)
      const def = catalogo.comportamento(verso, r.causale, giorno, r.causaleAziendaId)
      const predecessore = r.movimentoRettificatoId
        ? (numeroPredecessore.get(r.movimentoRettificatoId) ?? null)
        : null
      return {
        movimentoId: r.id,
        tipoAnnotazione: r.tipoAnnotazione,
        numero: { anno: r.progressiveYear, progressivo: r.progressiveNumber },
        dataRegistrazione: r.registrationDate.toISOString(),
        verso,
        codiceRentri: def?.codiceRentri ?? null,
        cerCode: r.cerCode,
        descrizione: r.wasteDescription,
        quantita: Number(r.quantity),
        unit: r.unit,
        statoFisico: r.wastePhysicalState,
        classiPericolo: r.wasteHazardClasses,
        operazione: r.operationCode,
        predecessore,
        motivo: r.motivoAnnotazione,
        fir: r.firId ? (firPerId.get(r.firId) ?? null) : null,
        riferimentiCarico: verso === 'SCARICO' ? (riferimenti.get(r.id) ?? []) : [],
      }
    })
  }

  /** FIR -> dati per il registro, con parti e indirizzo del produttore (comune risolto in blocco). */
  private async costruisciFir(
    tx: Tx,
    tenantId: string,
    firs: Awaited<ReturnType<Tx['fIR']['findMany']>>
  ): Promise<Map<string, DatiFirPerRegistro>> {
    const risultato = new Map<string, DatiFirPerRegistro>()
    if (firs.length === 0) return risultato

    const idsProduttori = unici(firs.map(f => f.producerId))
    const idsDestinatari = unici(firs.map(f => f.receiverId))
    const idsTrasportatori = unici(firs.map(f => f.carrierId))
    const idsSedi = unici(firs.flatMap(f => [f.producerSedeId, f.receiverSedeId]))

    const includeDitta = { ditta: true, sede: true } as const
    const [produttori, destinatari, trasportatori, sedi] = await Promise.all([
      idsProduttori.length
        ? tx.produttore.findMany({
            where: { id: { in: idsProduttori }, tenantId },
            include: includeDitta,
          })
        : [],
      idsDestinatari.length
        ? tx.destinatario.findMany({
            where: { id: { in: idsDestinatari }, tenantId },
            include: includeDitta,
          })
        : [],
      idsTrasportatori.length
        ? tx.trasportatore.findMany({
            where: { id: { in: idsTrasportatori }, tenantId },
            include: includeDitta,
          })
        : [],
      idsSedi.length ? tx.sedeDitta.findMany({ where: { id: { in: idsSedi }, tenantId } }) : [],
    ])
    const produttorePerId = new Map(produttori.map(p => [p.id, p]))
    const destinatarioPerId = new Map(destinatari.map(p => [p.id, p]))
    const trasportatorePerId = new Map(trasportatori.map(p => [p.id, p]))
    const sedePerId = new Map(sedi.map(s => [s.id, s]))

    // Sede del produttore: quella scelta sul FIR (se della stessa ditta) o la predefinita.
    const sedeProduttore = (f: (typeof firs)[number]): SedeLetta | null => {
      const riga = f.producerId ? produttorePerId.get(f.producerId) : undefined
      if (!riga) return null
      const scelta = f.producerSedeId ? sedePerId.get(f.producerSedeId) : undefined
      if (f.producerSedeId) return scelta && scelta.dittaId === riga.dittaId ? scelta : null
      return riga.sede
    }

    const comuni = await this.risolviComuni(
      tx,
      firs.map(f => sedeProduttore(f)).filter((s): s is SedeLetta => s !== null)
    )

    for (const f of firs) {
      const prod = f.producerId ? produttorePerId.get(f.producerId) : undefined
      const dest = f.receiverId ? destinatarioPerId.get(f.receiverId) : undefined
      const tras = f.carrierId ? trasportatorePerId.get(f.carrierId) : undefined
      const sede = sedeProduttore(f)
      const comuneId = sede ? comuni.get(chiaveComune(sede.comune, sede.provincia)) : undefined
      const via = sede?.via?.trim()
      const civico = sede?.civico?.trim()
      const cap = sede?.cap?.trim()
      const indirizzo: IndirizzoRentri | null =
        comuneId && via && civico && cap
          ? { citta: { comune_id: comuneId }, indirizzo: via, civico, cap }
          : null
      const cf = (
        snapshot: string | null,
        ditta?: { codiceFiscale: string | null; partitaIva: string | null }
      ) => snapshot?.trim() || ditta?.codiceFiscale || ditta?.partitaIva || null

      risultato.set(f.id, {
        numeroFir: f.rentriNumeroFir ?? f.firNumber,
        dataInizioTrasporto: f.transportDate.toISOString(),
        dataFineTrasporto: f.actualArrivalDate ? f.actualArrivalDate.toISOString() : null,
        pesoVerificatoDestinoKg: f.effectiveWeight === null ? null : Number(f.effectiveWeight),
        provenienza: f.provenienza === 'URBANO' ? 'U' : f.provenienza === 'SPECIALE' ? 'S' : null,
        // Parte agganciata ma sede mancante, di un'altra ditta o comune non riconosciuto: la parte
        // c'e' con `indirizzo: null` (la traduzione dice quale dato manca). `null` solo se non agganciata.
        produttore: prod
          ? {
              denominazione: prod.ditta.ragioneSociale,
              codiceFiscale: cf(f.producerCodiceFiscale, prod.ditta),
              indirizzo,
            }
          : null,
        trasportatore: tras
          ? {
              denominazione: tras.ditta.ragioneSociale,
              codiceFiscale: cf(f.carrierCodiceFiscale, tras.ditta),
              numeroIscrizioneAlbo: tras.numeroIscrizione ?? null,
            }
          : null,
        destinatario: dest
          ? {
              denominazione: dest.ditta.ragioneSociale,
              codiceFiscale: cf(f.receiverCodiceFiscale, dest.ditta),
              numeroAutorizzazione: dest.numeroAutorizzazione ?? null,
            }
          : null,
      })
    }
    return risultato
  }

  /** Una sola query per tutti i (comune, provincia) distinti. Non risolto = assente dalla mappa. */
  private async risolviComuni(tx: Tx, sedi: SedeLetta[]): Promise<Map<string, string>> {
    const coppie = new Map<string, { nome: string; sigla: string }>()
    for (const s of sedi) {
      const nome = s.comune?.trim()
      const sigla = s.provincia?.trim().toUpperCase()
      if (nome && sigla) coppie.set(chiaveComune(nome, sigla), { nome, sigla })
    }
    const risultato = new Map<string, string>()
    if (coppie.size === 0) return risultato
    const righe = await tx.istatComune.findMany({
      where: {
        OR: [...coppie.values()].map(c => ({
          name: { equals: c.nome, mode: 'insensitive' as const },
          provinciaSigla: c.sigla,
        })),
      },
      select: { code: true, name: true, provinciaSigla: true },
    })
    for (const r of righe) risultato.set(chiaveComune(r.name, r.provinciaSigla), r.code)
    return risultato
  }

  /** Riferimenti di carico (D6) per gli scarichi richiesti, dal FIFO delle vigenti e delle aperture. */
  private async riferimentiCarico(
    tx: Tx,
    tenantId: string,
    registroId: string,
    richieste: Array<{ id: string; type: string }>
  ): Promise<Map<string, NumeroRegistrazione[]>> {
    if (!richieste.some(r => r.type === 'SCARICO')) return new Map()

    const [vigenti, aperture] = await Promise.all([
      tx.wasteMovement.findMany({
        where: { tenantId, registroId, ...WHERE_VIGENTE },
        select: {
          id: true,
          type: true,
          movementDate: true,
          quantity: true,
          unit: true,
          cerCode: true,
          progressiveYear: true,
          progressiveNumber: true,
        },
      }),
      leggiApertureRegistro(tx, tenantId, { registroId }),
    ])
    const idsAperture = unici(aperture.map(a => a.id))
    const conOrigini = idsAperture.length
      ? await tx.giacenzaIniziale.findMany({
          where: { id: { in: idsAperture }, tenantId },
          select: { id: true, origini: true },
        })
      : []

    const numeri = new Map<string, NumeroRegistrazione>()
    const eventi: EventoPerRiferimenti[] = []
    let scartati = 0
    const valido = (q: number) => Number.isFinite(q) && millesimiFifo(q) > 0

    for (const v of vigenti) {
      numeri.set(v.id, { anno: v.progressiveYear, progressivo: v.progressiveNumber })
      const quantita = Number(v.quantity)
      if (!valido(quantita)) {
        scartati++
        continue
      }
      eventi.push({
        tipo: v.type,
        giorno: giornoItaliano(v.movementDate),
        quantita,
        origine: 'MOVIMENTO',
        ordine: v.progressiveYear * 1e7 + v.progressiveNumber,
        riferimento: { id: v.id },
        cerCode: v.cerCode,
        unit: v.unit,
      })
    }
    const originiAperture = new Map<string, NumeroRegistrazione[]>()
    let malformate = 0
    for (const g of conOrigini) {
      const origini = leggiOrigini(g.origini)
      if (origini === null) malformate++
      originiAperture.set(g.id, origini ?? [])
    }
    for (const a of aperture) {
      if (!a.id) continue
      if (!valido(a.quantita)) {
        scartati++
        continue
      }
      eventi.push({
        tipo: 'CARICO',
        giorno: a.dataRiferimento,
        quantita: a.quantita,
        origine: 'APERTURA',
        ordine: 0,
        riferimento: { id: a.id },
        cerCode: a.cerCode,
        unit: a.unita,
      })
    }
    // `calcolaFifo` rifiuta le quantita' <= 0,001: si scartano qui, senza id nel log.
    if (scartati > 0) {
      this.logger.warn('Eventi con quantita trascurabile esclusi dai riferimenti di carico', {
        eventiEsclusi: scartati,
      })
    }
    if (malformate > 0) {
      this.logger.warn('Aperture con origini malformate: nessun riferimento da quelle aperture', {
        aperture: malformate,
      })
    }
    return riferimentiCaricoPerScarichi(eventi, numeri, originiAperture)
  }
}

const chiaveComune = (nome: string, sigla: string) =>
  `${nome.trim().toLowerCase()}|${sigla.trim().toUpperCase()}`

/** `[{ anno, protocollo }]` con interi; qualunque altra forma = null (malformata). */
function leggiOrigini(valore: unknown): NumeroRegistrazione[] | null {
  if (!Array.isArray(valore)) return null
  const risultato: NumeroRegistrazione[] = []
  for (const o of valore) {
    const anno = (o as { anno?: unknown })?.anno
    const protocollo = (o as { protocollo?: unknown })?.protocollo
    if (!Number.isInteger(anno) || !Number.isInteger(protocollo)) return null
    risultato.push({ anno: anno as number, progressivo: protocollo as number })
  }
  return risultato
}
