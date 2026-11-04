// Parti pure del servizio di conferma del legame (fase 4.3, Task 16): validazione delle modifiche
// scritte dall'utente, fusione delle righe del legame con la proposta ricalcolata e applicazione
// delle modifiche di quantita', prezzo e sconto. Nessun accesso al database: le regole sono nel
// dominio (`valori-legame`), qui si decide solo come applicarle alle righe e quale errore dare.
import { BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  puoModificarePrezzoRiga,
  validaPrezzoManuale,
  validaQuantitaManuale,
  validaScontoManuale,
} from '../../domain/legami-movimento/valori-legame'
import type { StatoLegame } from '../../domain/legami-movimento/codici'
import type { RigaPropostaVista } from './proposta-legame.service'

/** Modifica di una riga del legame, come arriva dal client (numeri come stringhe col punto). */
export interface ModificaRigaLegame {
  rigaAddebitoId: string
  /** Stringa > 0 con al massimo 3 decimali; `null` = torna alla quantita' derivata dal movimento. */
  quantita?: string | null
  /** Stringa >= 0 con al massimo 6 decimali (zero esplicito ammesso). */
  prezzo?: string
  /** Formula a cascata valida; `null` la toglie. */
  sconto?: string | null
  /** Toglie la riga dal legame (per tornare al listino si toglie e si riaggiunge). */
  rimuovi?: boolean
}

export interface ModificheLegame {
  clienteId?: string
  contrattoId?: string
  elencoId?: string
  /**
   * Una riga gia' nel legame si modifica; una riga dell'elenco non ancora nel legame (solo
   * `rigaAddebitoId`, o con valori) viene aggiunta come `MANUALE`.
   */
  righe?: ModificaRigaLegame[]
}

/** Riga del legame in memoria (la riga del database, con i decimali come stringhe normalizzate). */
export interface RigaMem {
  /** `null` = riga nuova, ancora da inserire. */
  id: string | null
  rigaAddebitoId: string
  ordine: number
  origine: 'PRINCIPALE' | 'PROPOSTA' | 'MANUALE'
  tipo: string
  descrizione: string | null
  tipoQuantita: string | null
  unitaMisura: string
  quantita: string | null
  quantitaOrigine: 'DA_MOVIMENTO' | 'MANUALE' | null
  prezzoSpeciale: boolean
  prezzo: string | null
  sconto: string | null
  prezzoManuale: boolean
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
  /** I valori sono congelati (`congelata_il` valorizzata). */
  congelata: boolean
}

export interface ModificaRigaNorm {
  quantita?: string | null
  prezzo?: string
  sconto?: string | null
  rimuovi: boolean
}

export interface ModificheNorm {
  clienteId?: string
  contrattoId?: string
  elencoId?: string
  righe: Map<string, ModificaRigaNorm>
}

/** Cambio di un valore di una riga, per l'audit. */
export interface CambioRiga {
  rigaAddebitoId: string
  quantita?: { prima: string | null; dopo: string | null }
  prezzo?: { prima: string | null; dopo: string | null }
  sconto?: { prima: string | null; dopo: string | null }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const eUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export function normalizzaDec(v: string | null): string | null {
  return v === null ? null : new Prisma.Decimal(v).toFixed()
}

const nonValido = (error: string, message: string) => new BadRequestException({ error, message })

function uuidFacoltativo(v: unknown, etichetta: string): string | undefined {
  if (v === undefined || v === null) return undefined
  if (!eUuid(v)) throw nonValido('IDENTIFICATIVO_NON_VALIDO', `${etichetta} non valido.`)
  return v
}

/**
 * Valida le modifiche prima di toccare il database e le porta in forma normalizzata. Gli errori
 * sono 400 con un codice per campo (`QUANTITA_NON_VALIDA`, `PREZZO_NON_VALIDO`,
 * `SCONTO_NON_VALIDO`): i numeri devono essere stringhe col punto, mai numeri JSON.
 */
export function validaModifiche(m: ModificheLegame | undefined): ModificheNorm {
  const norm: ModificheNorm = { righe: new Map() }
  if (!m) return norm
  norm.clienteId = uuidFacoltativo(m.clienteId, 'Cliente')
  norm.contrattoId = uuidFacoltativo(m.contrattoId, 'Contratto')
  norm.elencoId = uuidFacoltativo(m.elencoId, 'Elenco')
  if (m.righe === undefined || m.righe === null) return norm
  if (!Array.isArray(m.righe)) throw nonValido('RIGHE_NON_VALIDE', 'Le righe non sono valide.')
  for (const r of m.righe) {
    if (!r || !eUuid(r.rigaAddebitoId)) {
      throw nonValido('IDENTIFICATIVO_NON_VALIDO', 'Riga non valida.')
    }
    if (norm.righe.has(r.rigaAddebitoId)) {
      throw nonValido('RIGA_DUPLICATA', 'La stessa riga è indicata più volte.')
    }
    const n: ModificaRigaNorm = { rimuovi: r.rimuovi === true }
    if (r.quantita !== undefined) {
      if (r.quantita === null) n.quantita = null
      else {
        const q = validaQuantitaManuale(r.quantita)
        if (!q.ok) throw nonValido('QUANTITA_NON_VALIDA', q.errore)
        n.quantita = normalizzaDec(q.valore)
      }
    }
    if (r.prezzo !== undefined) {
      const p = validaPrezzoManuale(r.prezzo)
      if (!p.ok) throw nonValido('PREZZO_NON_VALIDO', p.errore)
      n.prezzo = normalizzaDec(p.valore) as string
    }
    if (r.sconto !== undefined) {
      const s = validaScontoManuale(r.sconto)
      if (!s.ok) throw nonValido('SCONTO_NON_VALIDO', s.errore)
      n.sconto = s.valore
    }
    if (
      n.rimuovi &&
      (n.quantita !== undefined || n.prezzo !== undefined || n.sconto !== undefined)
    ) {
      throw nonValido('RIGA_NON_VALIDA', 'Una riga da togliere non può avere altre modifiche.')
    }
    norm.righe.set(r.rigaAddebitoId, n)
  }
  return norm
}

/** Riga della proposta come riga in memoria, ancora da inserire. */
export function righaDaProposta(p: RigaPropostaVista): RigaMem {
  if (p.aliquotaIva === null) throw new Error('Legame: aliquota IVA della riga mancante')
  return {
    id: null,
    rigaAddebitoId: p.rigaAddebitoId,
    ordine: p.ordine,
    origine: p.origine,
    tipo: p.tipo,
    descrizione: p.descrizione,
    tipoQuantita: p.tipoQuantita,
    unitaMisura: p.unitaMisura,
    quantita: p.quantita,
    quantitaOrigine: p.quantitaOrigine,
    prezzoSpeciale: p.prezzoSpeciale,
    prezzo: p.prezzo,
    sconto: p.sconto,
    prezzoManuale: false,
    codiceIvaId: p.codiceIvaId,
    aliquotaIva: p.aliquotaIva,
    naturaIva: p.naturaIva,
    congelata: false,
  }
}

/**
 * Fonde le righe del legame con quelle della proposta ricalcolata (che e' l'unica a dire quali
 * righe ci sono e in che ordine). Con lo stesso elenco: una riga con prezzo scritto a mano o con
 * valori congelati tiene prezzo, sconto e IVA; una quantita' `MANUALE` non si sovrascrive (salvo
 * `riderivaQuantita`: l'utente ha chiesto di tornare al movimento); tutto il resto si riallinea
 * al listino. Una proposta senza righe (elenco scaduto) lascia le righe com'erano. Con un elenco
 * diverso le righe sono tutte nuove.
 */
export function fondiRighe(
  esistenti: readonly RigaMem[],
  proposte: readonly RigaPropostaVista[],
  opz: { stessoElenco: boolean; riderivaQuantita: ReadonlySet<string> }
): RigaMem[] {
  if (!opz.stessoElenco) return proposte.map(righaDaProposta)
  if (proposte.length === 0) return esistenti.map(r => ({ ...r }))
  const perRiga = new Map(esistenti.map(r => [r.rigaAddebitoId, r]))
  return proposte.map(p => {
    const e = perRiga.get(p.rigaAddebitoId)
    if (!e) return righaDaProposta(p)
    const tieniQuantita =
      e.quantitaOrigine === 'MANUALE' && !opz.riderivaQuantita.has(p.rigaAddebitoId)
    const tieniValori = e.prezzoManuale || e.congelata
    const base: RigaMem = tieniValori
      ? { ...e }
      : { ...righaDaProposta(p), id: e.id, congelata: e.congelata }
    return {
      ...base,
      ordine: p.ordine,
      origine: p.origine,
      quantita: tieniQuantita ? e.quantita : p.quantita,
      quantitaOrigine: tieniQuantita ? 'MANUALE' : p.quantitaOrigine,
    }
  })
}

/**
 * Applica quantita', prezzo e sconto scritti a mano. Prezzo o sconto: solo se
 * `puoModificarePrezzoRiga` (riga a prezzo singolo di un legame non fatturato), imposta
 * `prezzoManuale`; il prezzo manuale richiede un prezzo (lo sconto da solo su una riga senza
 * prezzo e' un 400). Restituisce le righe nuove e i cambi per l'audit.
 */
export function applicaModificheRighe(
  righe: readonly RigaMem[],
  mods: ModificheNorm,
  stato: StatoLegame
): { righe: RigaMem[]; cambi: CambioRiga[] } {
  const cambi: CambioRiga[] = []
  const nuove = righe.map(r => {
    const m = mods.righe.get(r.rigaAddebitoId)
    if (!m || m.rimuovi) return r
    const riga = { ...r }
    const cambio: CambioRiga = { rigaAddebitoId: r.rigaAddebitoId }
    if (m.quantita !== undefined && m.quantita !== null) {
      cambio.quantita = { prima: r.quantita, dopo: m.quantita }
      riga.quantita = m.quantita
      riga.quantitaOrigine = 'MANUALE'
    }
    if (m.prezzo !== undefined || m.sconto !== undefined) {
      if (!puoModificarePrezzoRiga({ stato, prezzoSpeciale: r.prezzoSpeciale })) {
        if (r.prezzoSpeciale) {
          throw nonValido(
            'PREZZO_SPECIALE_NON_MODIFICABILE',
            'Una riga a prezzo speciale non ha un prezzo da modificare: lo calcola la fatturazione.'
          )
        }
        throw new ConflictException({
          error: 'STATO_LEGAME_NON_AMMESSO',
          message: 'Nello stato attuale il legame non si può modificare.',
        })
      }
      if (m.prezzo !== undefined) {
        cambio.prezzo = { prima: r.prezzo, dopo: m.prezzo }
        riga.prezzo = m.prezzo
      }
      if (m.sconto !== undefined) {
        cambio.sconto = { prima: r.sconto, dopo: m.sconto }
        riga.sconto = m.sconto
      }
      if (riga.prezzo === null) {
        throw nonValido('PREZZO_NON_VALIDO', 'Prezzo: indica il prezzo della riga.')
      }
      riga.prezzoManuale = true
    }
    if (cambio.quantita || cambio.prezzo || cambio.sconto) cambi.push(cambio)
    return riga
  })
  return { righe: nuove, cambi }
}
