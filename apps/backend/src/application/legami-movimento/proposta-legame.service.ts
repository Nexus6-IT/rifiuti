// Proposta del legame movimento-cliente-prezzo (fase 4.3, spec §6 e §7.1). Un servizio di
// applicazione legge i dati (letture-legame.ts) e chiama le funzioni di dominio PURE
// (proposta-contratto, proposta-righe, valori-legame, stato-legame): qui non ci sono regole nuove.
//
// - `calcola` / `calcolaInTx`: SOLA LETTURA, per la schermata di registrazione e per chi deve
//   scrivere. Nessuna scrittura, nessun lock.
// - `proponiEScrivi`: il percorso di scrittura (registrazione senza conferma, lista «da
//   collegare»). Prende i lock nell'ordine di spec §5 (il lock del registro lo ha gia' il
//   chiamante) e poi delega a `scriviProposta` l'unico INSERT.
//
// I nomi dei campi della vista sono quelli di `legami/legami.model.ts` del frontend
// (`PropostaLegame`): il backend li segue.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  MOTIVI_LEGAME,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from '../../domain/legami-movimento/codici'
import {
  dataFatturazioneValida,
  movimentoInFatturazione,
} from '../../domain/legami-movimento/fatturazione-da'
import {
  proponiCliente,
  proponiContratto,
  proponiElenco,
  verificaContrattoScelto,
  type ContrattoCandidato,
  type ElencoCandidato,
} from '../../domain/legami-movimento/proposta-contratto'
import { quantitaPerRiga, scegliRighe } from '../../domain/legami-movimento/proposta-righe'
import { statoDopoRicalcolo } from '../../domain/legami-movimento/stato-legame'
import {
  copiaValoriDaRiga,
  motiviRighe,
  type RigaLegameValori,
} from '../../domain/legami-movimento/valori-legame'
import { importoRiga } from '../../domain/listino/importi-riga'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { MSG_OPERAZIONE_CONCORRENTE } from '../clienti/anagrafica-versionata'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { leggiFatturazioneDaInTx } from './impostazioni-fatturazione.service'
import {
  clienteDaFir,
  firEsiste,
  leggiCliente,
  leggiDatiPerProposta,
  leggiEtichetteListino,
  leggiScelteProposta,
  type RigaListinoLetta,
} from './letture-legame'
import { scriviProposta } from './legame-scrittura'
import { bloccaLegamePerRadice, bloccaListinoInCondivisione } from './lock-legame'

/** Dati del movimento (non ancora registrato, o gia' registrato) da cui nasce la proposta. */
export interface InputProposta {
  /** Codice della causale (di sistema o `AZ_...`), come nel registro. */
  causale: string
  /** Versione aziendale esatta della causale, se nota; altrimenti vale la versione alla data. */
  causaleAziendaId?: string | null
  type: 'CARICO' | 'SCARICO'
  cerCode: string
  /** `AAAA-MM-GG` oppure un istante ISO: il giorno che conta e' quello italiano. */
  movementDate: string
  unit: string
  /** Stringa decimale col punto (`Decimal.toFixed()`, mai la notazione esponenziale). */
  quantity: string
  firId?: string | null
  /** Sede del produttore: con il FIR la ricava il server e il valore qui deve coincidere. */
  producerSedeId?: string | null
}

/** Scelte dell'utente che prevalgono sulla proposta. */
export interface ScelteProposta {
  clienteId?: string
  contrattoId?: string
  elencoId?: string
  /** Selezione completa delle righe dell'elenco (principale e V); sostituisce la proposta. */
  righeIds?: string[]
}

export type OrigineRigaVista = 'PRINCIPALE' | 'PROPOSTA' | 'MANUALE'

export interface VoceSceltaVista {
  id: string
  etichetta: string
}

/**
 * Riga della vista. Come `RigaLegame` del frontend, piu' `codiceIvaId` (serve a `scriviProposta`
 * per la FK; il frontend lo ignora). `congelataIl` e' sempre `null` in una proposta.
 */
export interface RigaPropostaVista {
  rigaAddebitoId: string
  codiceIvaId: string
  ordine: number
  origine: OrigineRigaVista
  tipo: string
  descrizione: string | null
  tipoQuantita: string | null
  unitaMisura: string
  quantita: string | null
  quantitaOrigine: 'DA_MOVIMENTO' | null
  prezzoSpeciale: boolean
  prezzo: string | null
  sconto: string | null
  prezzoManuale: boolean
  aliquotaIva: string | null
  naturaIva: string | null
  congelataIl: null
  /** Importo netto calcolato con `importoRiga`; `null` se non calcolabile (prezzo speciale, quantita' mancante). */
  importo: string | null
}

/**
 * Proposta calcolata. Come `PropostaLegame` del frontend, piu' `fatturabile` e `attiva`: se uno
 * dei due e' falso lo `stato` e' `'ESCLUSO'` (virtuale, mai scritto) e non c'e' altro.
 */
export interface PropostaVista {
  fatturabile: boolean
  attiva: boolean
  stato: StatoLegame
  cliente: (VoceSceltaVista & { fonte: 'FIR' | 'UTENTE' }) | null
  dettaglioCliente: string | null
  contratto: VoceSceltaVista | null
  elenco: VoceSceltaVista | null
  righe: RigaPropostaVista[]
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  candidati: {
    contratti: VoceSceltaVista[]
    elenchi: VoceSceltaVista[]
    righe: (VoceSceltaVista & { origine: OrigineRigaVista })[]
  }
}

export interface RisultatoProponiEScrivi {
  /** `null` se non c'e' nulla da scrivere (fatturazione spenta, causale non fatturabile). */
  legameId: string | null
  /** `false` se il legame della catena c'era gia' (o non si scrive). */
  creato: boolean
  /** La proposta scritta; `null` se il legame esisteva gia'. */
  proposta: PropostaVista | null
}

const dataNonValida = () =>
  new BadRequestException({
    error: 'DATA_MOVIMENTO_NON_VALIDA',
    message: 'Data del movimento non valida.',
  })

/**
 * Giorno italiano (`AAAA-MM-GG`) della data del movimento. Una data senza ora e' gia' il
 * giorno; un istante ISO si porta al calendario di Roma (`giornoItaliano`), come fa lo SQL
 * `sqlGiornoMovimento`.
 */
export function giornoDelMovimento(movementDate: string): string {
  if (typeof movementDate !== 'string') throw dataNonValida()
  if (/^\d{4}-\d{2}-\d{2}$/.test(movementDate)) {
    if (!dataFatturazioneValida(movementDate)) throw dataNonValida()
    return movementDate
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(movementDate)) throw dataNonValida()
  const d = new Date(movementDate)
  if (Number.isNaN(d.getTime())) throw dataNonValida()
  return giornoItaliano(d)
}

/** Decimale del database (`22.00`, `1.000000`) senza zeri finali e senza esponente. */
export function normalizzaDecimale(v: string | null): string | null {
  return v === null ? null : new Prisma.Decimal(v).toFixed()
}

/** Importo netto della riga, o `null` se non calcolabile (mai un'eccezione: la vista non cade). */
export function importoVista(
  quantita: string | null,
  prezzo: string | null,
  sconto: string | null
): string | null {
  if (quantita === null || prezzo === null) return null
  try {
    return importoRiga(quantita, prezzo, sconto).netto
  } catch {
    return null
  }
}

const rigaNonSelezionabile = () =>
  new BadRequestException({
    error: 'RIGA_NON_SELEZIONABILE',
    message: 'La riga scelta non si può usare per questo movimento.',
  })

function etichettaRiga(r: RigaListinoLetta): string {
  const parti = [r.tipo, r.tipo === 'CER' ? r.cerCode : r.addebitoCodice, r.descrizione]
  return parti.filter((p): p is string => p !== null && p !== '').join(' - ')
}

function elencoValidoAl(e: ElencoCandidato, giorno: string): boolean {
  return (
    (e.validoDal === null || e.validoDal <= giorno) && (e.validoAl === null || e.validoAl >= giorno)
  )
}

function propostaNonApplicabile(fatturabile: boolean, attiva: boolean): PropostaVista {
  return {
    fatturabile,
    attiva,
    stato: 'ESCLUSO',
    cliente: null,
    dettaglioCliente: null,
    contratto: null,
    elenco: null,
    righe: [],
    motivi: [],
    avvisi: [],
    candidati: { contratti: [], elenchi: [], righe: [] },
  }
}

@Injectable()
export class PropostaLegameService {
  constructor(private readonly prisma: PrismaService) {}

  /** Proposta per i dati di un movimento: sola lettura, in una transazione dell'azienda. */
  async calcola(
    tenantId: string,
    i: InputProposta,
    scelte: ScelteProposta = {}
  ): Promise<PropostaVista> {
    return this.prisma.$transaction(tx => this.calcolaInTx(tx, tenantId, i, scelte))
  }

  /**
   * Come `calcola` dentro una transazione gia' aperta (registrazione, lista «da collegare»).
   * `opz.fatturazioneDa` evita di rileggerla quando il chiamante l'ha gia' letta (e bloccata).
   * NON prende lock: chi poi scrive deve usare `proponiEScrivi`.
   */
  async calcolaInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    i: InputProposta,
    scelte: ScelteProposta = {},
    opz: { fatturazioneDa?: string | null } = {}
  ): Promise<PropostaVista> {
    const giorno = giornoDelMovimento(i.movementDate)
    const fatturazioneDa =
      opz.fatturazioneDa !== undefined
        ? opz.fatturazioneDa
        : await leggiFatturazioneDaInTx(tx, tenantId)
    const attiva = movimentoInFatturazione(giorno, fatturazioneDa)
    const catalogo = await caricaCatalogoCausali(tx, tenantId)
    const def = catalogo.comportamento(i.type, i.causale, giorno, i.causaleAziendaId ?? null)
    const fatturabile = def?.fatturabile === true
    if (!fatturabile || !attiva) return propostaNonApplicabile(fatturabile, attiva)

    const motivi = new Set<MotivoLegame>()
    const avvisi: AvvisoLegame[] = []
    const aggiungiAvviso = (a: AvvisoLegame) => {
      if (!avvisi.includes(a)) avvisi.push(a)
    }

    // --- Cliente (§6.2): FIR -> produttore -> ditta -> cliente attivo, oppure scelta dell'utente.
    let sedeFir: string | null = null
    let daFir = null as Awaited<ReturnType<typeof clienteDaFir>>['cliente']
    if (i.firId) {
      const r = await clienteDaFir(tx, tenantId, i.firId)
      if (r.cliente === null && r.sedeId === null && !(await firEsiste(tx, tenantId, i.firId))) {
        // Stesso 404 per un FIR inesistente e per quello di un'altra azienda.
        throw new NotFoundException({ error: 'FIR_NON_TROVATO', message: 'FIR non trovato.' })
      }
      daFir = r.cliente
      sedeFir = r.sedeId
      if (sedeFir !== null && i.producerSedeId && i.producerSedeId !== sedeFir) {
        throw new BadRequestException({
          error: 'SEDE_PRODUTTORE_NON_COERENTE',
          message: 'La sede del produttore non coincide con quella del FIR.',
        })
      }
    }
    // La sede guida la scelta del contratto SOLO con il FIR (§6.3): `WasteMovement` non la
    // conserva, quindi senza FIR ogni percorso (registrazione, lista, rettifica) la ignora.
    const sedeId = i.firId ? sedeFir : null
    const daProposta = proponiCliente({ firPresente: !!i.firId, clienteDaFir: daFir })
    avvisi.push(...daProposta.avvisi)

    let cliente: PropostaVista['cliente'] = null
    let dettaglioCliente: string | null = daProposta.dettaglioCliente ?? null
    if (scelte.clienteId) {
      const c = await leggiCliente(tx, tenantId, scelte.clienteId)
      if (!c) {
        throw new NotFoundException({
          error: 'CLIENTE_NON_TROVATO',
          message: 'Cliente non trovato.',
        })
      }
      if (!c.attivo) {
        throw new BadRequestException({
          error: 'CLIENTE_NON_ATTIVO',
          message: 'Il cliente scelto è disattivato.',
        })
      }
      cliente = { id: c.id, etichetta: c.etichetta, fonte: 'UTENTE' }
      dettaglioCliente = null
    } else if (daProposta.clienteId) {
      const c = await leggiCliente(tx, tenantId, daProposta.clienteId)
      if (c) cliente = { id: c.id, etichetta: c.etichetta, fonte: 'FIR' }
    }
    if (!cliente) {
      motivi.add('SENZA_CLIENTE')
      if (scelte.contrattoId || scelte.elencoId || (scelte.righeIds?.length ?? 0) > 0) {
        throw new BadRequestException({
          error: 'CLIENTE_NON_INDICATO',
          message: 'Scegli prima il cliente.',
        })
      }
      return this.componi({
        cliente: null,
        dettaglioCliente,
        contratto: null,
        elenco: null,
        righe: [],
        motivi,
        avvisi,
        candidati: { contratti: [], elenchi: [], righe: [] },
      })
    }

    // --- Controllo delle scelte: «non c'e'» (404) contro «non e' di chi dice» (400).
    const lette = await leggiScelteProposta(tx, tenantId, scelte)
    if (scelte.contrattoId) {
      if (!lette.contratto) {
        throw new NotFoundException({
          error: 'CONTRATTO_CLIENTE_NON_TROVATO',
          message: 'Contratto non trovato.',
        })
      }
      if (lette.contratto.clienteId !== cliente.id) {
        throw new BadRequestException({
          error: 'CONTRATTO_NON_DEL_CLIENTE',
          message: 'Il contratto scelto non è del cliente.',
        })
      }
    }
    if (scelte.elencoId) {
      if (!lette.elenco) {
        throw new NotFoundException({
          error: 'ELENCO_ADDEBITI_NON_TROVATO',
          message: 'Elenco di addebiti non trovato.',
        })
      }
      if (scelte.contrattoId && lette.elenco.contrattoId !== scelte.contrattoId) {
        throw new BadRequestException({
          error: 'ELENCO_NON_DEL_CONTRATTO',
          message: 'L’elenco scelto non è del contratto.',
        })
      }
      if (lette.elenco.clienteId !== cliente.id) {
        throw new BadRequestException({
          error: 'ELENCO_NON_DEL_CLIENTE',
          message: 'L’elenco scelto non è di un contratto del cliente.',
        })
      }
    }
    const righeIdsScelte = [...new Set(scelte.righeIds ?? [])]
    if (righeIdsScelte.length > 0 && lette.righe.length !== righeIdsScelte.length) {
      throw new NotFoundException({
        error: 'RIGA_ADDEBITO_NON_TROVATA',
        message: 'Riga di listino non trovata.',
      })
    }
    // Il contratto scelto o, se si e' scelto solo l'elenco, quello dell'elenco.
    const contrattoScelto = scelte.contrattoId ?? lette.elenco?.contrattoId ?? null

    // --- Dati del listino: quattro query, qualunque sia il numero di righe.
    const dati = await leggiDatiPerProposta(tx, tenantId, {
      cerCode: i.cerCode,
      movementDate: giorno,
      clienteId: cliente.id,
      sedeId,
    })
    const etichette = await leggiEtichetteListino(tx, tenantId, cliente.id)
    const voceContratto = (k: ContrattoCandidato): VoceSceltaVista => ({
      id: k.id,
      etichetta: etichette.contratti.get(k.id) ?? k.id,
    })
    const voceElenco = (e: ElencoCandidato): VoceSceltaVista => ({
      id: e.id,
      etichetta: etichette.elenchi.get(e.id) ?? e.id,
    })

    // --- Contratto (§6.3, decisione 10).
    let contratto: ContrattoCandidato | null = null
    if (contrattoScelto) {
      contratto = dati.contratti.find(k => k.id === contrattoScelto) ?? null
      if (!contratto) {
        throw new NotFoundException({
          error: 'CONTRATTO_CLIENTE_NON_TROVATO',
          message: 'Contratto non trovato.',
        })
      }
      const v = verificaContrattoScelto(contratto, giorno, sedeId)
      if (v.errore) motivi.add(v.errore)
      if (v.avvisoAltraSede) aggiungiAvviso('CONTRATTO_ALTRA_SEDE')
    } else {
      const e = proponiContratto(dati.contratti, giorno, sedeId)
      contratto = e.contratto
      if (e.motivo) motivi.add(e.motivo)
    }
    // Menu: i contratti validi alla data (di qualsiasi sede, la scelta a mano e' lecita) piu' quello scelto.
    const contrattiMenu = dati.contratti.filter(
      k => k.id === contratto?.id || verificaContrattoScelto(k, giorno, sedeId).errore === null
    )
    const candidatiContratti = contrattiMenu.map(voceContratto)
    if (!contratto) {
      if (righeIdsScelte.length > 0) throw rigaNonSelezionabile()
      return this.componi({
        cliente,
        dettaglioCliente,
        contratto: null,
        elenco: null,
        righe: [],
        motivi,
        avvisi,
        candidati: { contratti: candidatiContratti, elenchi: [], righe: [] },
      })
    }

    // --- Elenco.
    const elenchiContratto = dati.elenchi.filter(e => e.contrattoId === contratto.id)
    const proposto = proponiElenco(elenchiContratto, giorno)
    let elenco: ElencoCandidato | null
    let elencoNonValido = false
    if (scelte.elencoId) {
      elenco = elenchiContratto.find(e => e.id === scelte.elencoId) ?? null
      if (!elenco) {
        throw new BadRequestException({
          error: 'ELENCO_NON_DEL_CONTRATTO',
          message: 'L’elenco scelto non è del contratto.',
        })
      }
      if (!elencoValidoAl(elenco, giorno)) {
        // Non ancora iniziato: l'elenco non c'e' ancora (l'insieme dei motivi e' chiuso).
        motivi.add(
          elenco.validoDal !== null && elenco.validoDal > giorno ? 'SENZA_ELENCO' : 'ELENCO_SCADUTO'
        )
        elencoNonValido = true
      }
    } else {
      elenco = proposto.elenco
      if (proposto.motivo) motivi.add(proposto.motivo)
    }
    const elenchiMenu = elenchiContratto.filter(
      e => e.id === elenco?.id || elencoValidoAl(e, giorno)
    )
    const candidatiElenchi = elenchiMenu.map(voceElenco)
    if (!elenco || elencoNonValido) {
      if (righeIdsScelte.length > 0) throw rigaNonSelezionabile()
      return this.componi({
        cliente,
        dettaglioCliente,
        contratto: voceContratto(contratto),
        elenco: elenco ? voceElenco(elenco) : null,
        righe: [],
        motivi,
        avvisi,
        candidati: { contratti: candidatiContratti, elenchi: candidatiElenchi, righe: [] },
      })
    }

    // --- Righe (§6.3): principale CER e righe V proposte, oppure la selezione dell'utente.
    for (const r of lette.righe) {
      if (r.elencoId !== elenco.id) {
        throw new BadRequestException({
          error: 'RIGA_NON_DELL_ELENCO',
          message: 'La riga scelta non è dell’elenco.',
        })
      }
    }
    const righeElenco = dati.righe.filter(r => r.elencoId === elenco.id)
    const esito = scegliRighe(righeElenco, i.cerCode)
    const proposteIds = new Set(esito.proposte.map(r => r.id))
    let principale: RigaListinoLetta | null
    let scelteOrdinate: RigaListinoLetta[]
    let motivoRiga: MotivoLegame | null
    if (righeIdsScelte.length > 0) {
      const perId = new Map(righeElenco.map(r => [r.id, r]))
      scelteOrdinate = righeIdsScelte
        .map(id => perId.get(id) ?? null)
        .map(r => {
          if (!r) throw rigaNonSelezionabile()
          return r
        })
      const cer = scelteOrdinate.filter(r => r.tipo === 'CER')
      if (cer.length > 1) {
        throw new BadRequestException({
          error: 'RIGHE_CER_MULTIPLE',
          message: 'Scegli una sola riga per il codice CER.',
        })
      }
      if (cer.length === 1 && !esito.candidateCer.some(c => c.id === cer[0].id)) {
        throw rigaNonSelezionabile()
      }
      principale = cer[0] ?? null
      // La principale va sempre per prima, le altre nell'ordine scelto.
      scelteOrdinate = principale
        ? [principale, ...scelteOrdinate.filter(r => r.id !== principale!.id)]
        : scelteOrdinate
      motivoRiga = principale ? null : (esito.motivo ?? 'SENZA_RIGA_CER')
    } else {
      principale = (esito.principale as RigaListinoLetta | null) ?? null
      scelteOrdinate = [
        ...(principale ? [principale] : []),
        ...(esito.proposte as RigaListinoLetta[]),
      ]
      motivoRiga = esito.motivo
    }
    if (motivoRiga) motivi.add(motivoRiga)

    const ivaPerId = new Map(dati.codiciIva.map(c => [c.id, c]))
    const righe: RigaPropostaVista[] = scelteOrdinate.map((r, n) => {
      const iva = ivaPerId.get(r.codiceIvaId)
      if (!iva) throw new Error('Proposta del legame: codice IVA della riga non letto')
      const q = quantitaPerRiga(r, {
        quantity: normalizzaQuantitaMovimento(i.quantity),
        unit: i.unit,
      })
      const v = copiaValoriDaRiga({
        prezzo: r.prezzo,
        prezzoSpeciale: r.prezzoSpeciale,
        sconto: r.sconto,
        codiceIva: { id: iva.id, aliquota: iva.aliquota, natura: iva.natura },
      })
      const prezzo = normalizzaDecimale(v.prezzo)
      const origine: OrigineRigaVista =
        principale?.id === r.id ? 'PRINCIPALE' : proposteIds.has(r.id) ? 'PROPOSTA' : 'MANUALE'
      return {
        rigaAddebitoId: r.id,
        codiceIvaId: v.codiceIvaId,
        ordine: n + 1,
        origine,
        tipo: r.tipo,
        descrizione: r.descrizione,
        tipoQuantita: r.tipoQuantita,
        unitaMisura: r.unitaMisura,
        quantita: q,
        quantitaOrigine: q === null ? null : 'DA_MOVIMENTO',
        prezzoSpeciale: r.prezzoSpeciale,
        prezzo,
        sconto: v.sconto,
        prezzoManuale: false,
        aliquotaIva: normalizzaDecimale(v.aliquotaIva),
        naturaIva: v.naturaIva,
        congelataIl: null,
        importo: importoVista(q, prezzo, v.sconto),
      }
    })
    const valori: RigaLegameValori[] = righe.map(r => ({
      rigaAddebitoId: r.rigaAddebitoId,
      origine: r.origine,
      prezzoSpeciale: r.prezzoSpeciale,
      prezzo: r.prezzo,
      sconto: r.sconto,
      quantita: r.quantita,
      quantitaOrigine: r.quantitaOrigine,
      prezzoManuale: false,
      codiceIvaId: r.codiceIvaId,
    }))
    for (const m of motiviRighe(valori)) motivi.add(m)

    const candidatiRighe: PropostaVista['candidati']['righe'] = [
      ...esito.candidateCer.map(r => ({
        id: r.id,
        etichetta: etichettaRiga(r as RigaListinoLetta),
        origine: 'PRINCIPALE' as const,
      })),
      ...righeElenco
        .filter(r => r.tipo === 'V')
        .map(r => ({
          id: r.id,
          etichetta: etichettaRiga(r),
          origine: (proposteIds.has(r.id) ? 'PROPOSTA' : 'MANUALE') as OrigineRigaVista,
        })),
    ]
    return this.componi({
      cliente,
      dettaglioCliente,
      contratto: voceContratto(contratto),
      elenco: voceElenco(elenco),
      righe,
      motivi,
      avvisi,
      candidati: {
        contratti: candidatiContratti,
        elenchi: candidatiElenchi,
        righe: candidatiRighe,
      },
    })
  }

  /** Stato dai motivi e dalla completezza (dominio), motivi nell'ordine canonico. */
  private componi(
    p: Omit<PropostaVista, 'fatturabile' | 'attiva' | 'stato' | 'motivi'> & {
      motivi: Set<MotivoLegame>
    }
  ): PropostaVista {
    const motivi = MOTIVI_LEGAME.filter(m => p.motivi.has(m))
    const completo = !!p.cliente && !!p.contratto && !!p.elenco && p.righe.length > 0
    return {
      fatturabile: true,
      attiva: true,
      stato: statoDopoRicalcolo('NESSUN_LEGAME', { motivi, completo }) as StatoLegame,
      ...p,
      motivi,
    }
  }

  /**
   * Come `calcolaInTx`, ma bloccando FOR SHARE contratto, elenco e righe di listino su cui si
   * copiano i valori e ricalcolando sui valori bloccati (il listino puo' essere cambiato fra la
   * lettura e il lock). Chi chiama ha gia' il lock consultivo della radice (e quello del
   * registro, se scrive il registro): l'ordine di spec §5 e' suo. Fino a due giri di lock: se
   * dopo il lock la proposta ricalcolata usa un insieme diverso (elenco diventato valido, riga
   * aggiunta mentre si aspettava) si bloccano gli id nuovi e si ricalcola; se cambia ancora, 409.
   * Una proposta non applicabile (non fatturabile, non attiva) o senza contratto non blocca nulla.
   */
  async calcolaEBloccaInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    i: InputProposta,
    scelte: ScelteProposta | undefined,
    opz: { fatturazioneDa?: string | null }
  ): Promise<PropostaVista> {
    let proposta = await this.calcolaInTx(tx, tenantId, i, scelte, opz)
    let bloccata: string | null = null
    for (let giro = 0; ; giro++) {
      if (!proposta.fatturabile || !proposta.attiva) break
      // Senza contratto non si copia nulla dal listino: niente da proteggere.
      if (!proposta.contratto) break
      const chiave = chiaveInsieme(proposta)
      if (chiave === bloccata) break
      if (giro === 2) {
        throw new ConflictException({
          error: 'OPERAZIONE_CONCORRENTE',
          message: MSG_OPERAZIONE_CONCORRENTE,
        })
      }
      await bloccaListinoInCondivisione(
        tx,
        tenantId,
        proposta.contratto.id,
        proposta.elenco ? [proposta.elenco.id] : [],
        proposta.righe.map(r => r.rigaAddebitoId)
      )
      bloccata = chiave
      // Il listino puo' essere cambiato fra la lettura e il lock: i valori si prendono da qui.
      proposta = await this.calcolaInTx(tx, tenantId, i, scelte, opz)
    }
    return proposta
  }

  /**
   * Percorso di scrittura (registrazione senza conferma, lista «da collegare»). Il CHIAMANTE ha
   * gia' il lock del registro; qui, nell'ordine di spec §5: lock consultivo della radice ->
   * «fatturazione da» FOR SHARE -> contratto, elenco e righe di listino FOR SHARE (poi la
   * proposta si ricalcola sui valori bloccati) -> INSERT. Se il legame della catena c'e' gia' non
   * scrive e lo dice. Mai una scrittura su `waste_movements`.
   */
  async proponiEScrivi(
    tx: Prisma.TransactionClient,
    c: {
      tenantId: string
      userId: string | null
      registroId: string
      verso: 'CARICO' | 'SCARICO'
      movimentoOriginaleId: string
      movimentoVigenteId: string
      input: InputProposta
      scelte?: ScelteProposta
    }
  ): Promise<RisultatoProponiEScrivi> {
    await bloccaLegamePerRadice(tx, c.movimentoOriginaleId)
    const esistente = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM legami_movimento
      WHERE tenant_id = ${c.tenantId}::uuid AND movimento_originale_id = ${c.movimentoOriginaleId}::uuid`
    if (esistente.length > 0) return { legameId: esistente[0].id, creato: false, proposta: null }

    const fatturazioneDa = await leggiFatturazioneDaInTx(tx, c.tenantId, { condividi: true })
    const proposta = await this.calcolaEBloccaInTx(tx, c.tenantId, c.input, c.scelte, {
      fatturazioneDa,
    })
    if (!proposta.fatturabile || !proposta.attiva) {
      return { legameId: null, creato: false, proposta }
    }
    const { legameId } = await scriviProposta(tx, {
      tenantId: c.tenantId,
      userId: c.userId,
      registroId: c.registroId,
      verso: c.verso,
      movimentoOriginaleId: c.movimentoOriginaleId,
      movimentoVigenteId: c.movimentoVigenteId,
      dataMovimento: giornoDelMovimento(c.input.movementDate),
      proposta,
    })
    return { legameId, creato: true, proposta }
  }
}

/** La quantita' del movimento arriva come stringa: forma estesa, senza esponente (M9). */
function normalizzaQuantitaMovimento(q: string): string {
  try {
    return new Prisma.Decimal(q).toFixed()
  } catch {
    return q
  }
}

/** Insieme di contratto, elenco e righe su cui si copiano i valori: serve a sapere cosa e' bloccato. */
function chiaveInsieme(p: PropostaVista): string {
  return [
    p.contratto?.id ?? '',
    p.elenco?.id ?? '',
    ...p.righe.map(r => r.rigaAddebitoId).sort(),
  ].join('|')
}
