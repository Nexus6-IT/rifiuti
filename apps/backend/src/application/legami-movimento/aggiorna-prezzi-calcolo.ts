// Calcolo puro di «Aggiorna prezzi» (fase 4.3, Task 17, spec §7.4): dai legami letti dal database
// e dai valori correnti del listino decide, per ogni legame, che cosa cambia. Nessun accesso al
// database: lo stesso calcolo gira nell'anteprima, nel controllo della firma e sotto lock, cosi'
// le tre risposte non possono divergere.
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  MOTIVI_LEGAME,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from '../../domain/legami-movimento/codici'
import { puoAggiornarePrezzi, statoDopoRicalcolo } from '../../domain/legami-movimento/stato-legame'
import { avvisiDaRighe, motiviRighe } from '../../domain/legami-movimento/valori-legame'

/** Valori correnti della riga di listino da cui il legame ha copiato la sua riga. */
export interface ListinoAttuale {
  tipo: string
  prezzoSpeciale: boolean
  prezzo: string | null
  sconto: string | null
  codiceIvaId: string
  aliquota: string | null
  natura: string | null
  /** Per le righe `CER`: il CER della riga e' ancora quello del movimento vigente. */
  cerCoerente: boolean
}

export interface RigaLegameLetta {
  id: string
  rigaAddebitoId: string
  tipo: string
  prezzoSpeciale: boolean
  prezzoManuale: boolean
  prezzo: string | null
  sconto: string | null
  quantita: string | null
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
  /** `null` = la riga di listino non si trova piu' (non puo' succedere con la FK, ma si gestisce). */
  listino: ListinoAttuale | null
}

export interface LegameLetto {
  id: string
  versione: number
  stato: StatoLegame
  movimentoVigenteId: string
  clienteId: string | null
  contrattoId: string | null
  elencoId: string | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  /** Solo per i legami non fatturati: gli altri non si leggono riga per riga. */
  righe: RigaLegameLetta[]
}

export interface RigaDaScrivere {
  rigaId: string
  legameId: string
  movimentoId: string
  prezzoPrima: string | null
  prezzoDopo: string | null
  scontoPrima: string | null
  scontoDopo: string | null
  codiceIvaIdPrima: string
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
}

export interface LegameDaScrivere {
  legameId: string
  statoPrima: StatoLegame
  stato: StatoLegame
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  righe: RigaDaScrivere[]
}

export type StatoSaltato = 'FATTURATO' | 'IMPORTATO_FATTURATO' | 'ESCLUSO' | 'ANNULLATO'

export interface CalcoloAggiornamento {
  /** Legami nel perimetro che si possono aggiornare (id) con il loro digest. */
  scrivibili: Map<string, string>
  daScrivere: LegameDaScrivere[]
  invariati: number
  legamiSaltati: Record<StatoSaltato, number>
  righeSpeciali: number
  righeManuali: number
  /** Legami che dopo l'aggiornamento sono `DA_COLLEGARE` e prima non lo erano. */
  daCollegare: number
  /** Impronta del perimetro e di tutto cio' che l'utente vede nell'anteprima. */
  firma: string
}

const MOTIVI_DELLE_RIGHE: readonly MotivoLegame[] = ['SENZA_PREZZO', 'SENZA_QUANTITA']

function uguali(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return new Prisma.Decimal(a).equals(new Prisma.Decimal(b))
}

function ordinaMotivi(m: Iterable<MotivoLegame>): MotivoLegame[] {
  const set = new Set(m)
  return MOTIVI_LEGAME.filter(x => set.has(x))
}

function sha256(testo: string): string {
  return createHash('sha256').update(testo).digest('hex')
}

/**
 * Che cosa diventa una riga a prezzo singolo, non manuale, copiando il listino. Stessa regola di
 * `copiaValoriDaRiga` (dominio) per il prezzo e lo sconto; qui l'IVA arriva gia' letta dal
 * database e il prezzo speciale del listino (cambiato dopo la copia) vale «nessun prezzo».
 * Una riga di listino
 * diventata a prezzo speciale non ha un prezzo da copiare: il legame lo segnala con `SENZA_PREZZO`.
 */
function valoriDalListino(l: ListinoAttuale): {
  prezzo: string | null
  sconto: string | null
} {
  return l.prezzoSpeciale ? { prezzo: null, sconto: null } : { prezzo: l.prezzo, sconto: l.sconto }
}

function rigaCambiata(r: RigaLegameLetta, l: ListinoAttuale): boolean {
  const v = valoriDalListino(l)
  if (!uguali(r.prezzo, v.prezzo) || r.sconto !== v.sconto) return true
  if (r.codiceIvaId !== l.codiceIvaId) return true
  if (l.aliquota !== null && !uguali(r.aliquotaIva, l.aliquota)) return true
  return r.naturaIva !== l.natura
}

function digestLegame(l: LegameLetto): string {
  return sha256(
    JSON.stringify([
      l.id,
      l.versione,
      l.stato,
      l.clienteId,
      l.contrattoId,
      l.elencoId,
      l.movimentoVigenteId,
      l.motivi,
      l.avvisi,
      l.righe.map(r => [
        r.id,
        r.prezzoSpeciale,
        r.prezzoManuale,
        r.prezzo,
        r.sconto,
        r.quantita,
        r.codiceIvaId,
        r.aliquotaIva,
        r.naturaIva,
        r.listino && [
          r.listino.tipo,
          r.listino.prezzoSpeciale,
          r.listino.prezzo,
          r.listino.sconto,
          r.listino.codiceIvaId,
          r.listino.aliquota,
          r.listino.natura,
          r.listino.cerCoerente,
        ],
      ]),
    ])
  )
}

/**
 * Calcola l'aggiornamento. `chiavePerimetro` entra nella firma: la stessa firma non vale per un
 * altro perimetro. I legami `FATTURATO`, `IMPORTATO_FATTURATO`, `ESCLUSO` e `ANNULLATO` si contano
 * soltanto (e non entrano nella firma: non si scrivono mai).
 */
export function calcolaAggiornamento(
  legami: readonly LegameLetto[],
  chiavePerimetro: string
): CalcoloAggiornamento {
  const out: CalcoloAggiornamento = {
    scrivibili: new Map(),
    daScrivere: [],
    invariati: 0,
    legamiSaltati: { FATTURATO: 0, IMPORTATO_FATTURATO: 0, ESCLUSO: 0, ANNULLATO: 0 },
    righeSpeciali: 0,
    righeManuali: 0,
    daCollegare: 0,
    firma: '',
  }
  for (const l of [...legami].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!puoAggiornarePrezzi(l.stato)) {
      out.legamiSaltati[l.stato as StatoSaltato]++
      continue
    }
    out.scrivibili.set(l.id, digestLegame(l))
    const righeDaScrivere: RigaDaScrivere[] = []
    const dopo = new Map<string, { prezzo: string | null }>()
    let famigliaRotta = false
    for (const r of l.righe) {
      if (r.prezzoSpeciale) {
        out.righeSpeciali++
        continue
      }
      // Prima la famiglia, poi il prezzo manuale: una riga manuale la cui riga di listino non e'
      // piu' la stessa fa tornare il legame a `DA_COLLEGARE` senza toccare il prezzo scritto.
      if (
        r.listino === null ||
        r.listino.tipo !== r.tipo ||
        (r.tipo === 'CER' && !r.listino.cerCoerente)
      ) {
        famigliaRotta = true
        if (r.prezzoManuale) out.righeManuali++
        continue
      }
      if (r.prezzoManuale) {
        out.righeManuali++
        continue
      }
      if (!rigaCambiata(r, r.listino)) continue
      const v = valoriDalListino(r.listino)
      dopo.set(r.id, { prezzo: v.prezzo })
      righeDaScrivere.push({
        rigaId: r.id,
        legameId: l.id,
        movimentoId: l.movimentoVigenteId,
        prezzoPrima: r.prezzo,
        prezzoDopo: v.prezzo,
        scontoPrima: r.sconto,
        scontoDopo: v.sconto,
        codiceIvaIdPrima: r.codiceIvaId,
        codiceIvaId: r.listino.codiceIvaId,
        aliquotaIva: r.listino.aliquota ?? r.aliquotaIva,
        naturaIva: r.listino.natura,
      })
    }
    // La riga di listino e' tornata quella giusta: il motivo `SENZA_RIGA_CER` non ha piu' ragione
    // di restare (serve almeno una riga CER, coerente, a prezzo singolo, come prova).
    const riparata =
      !famigliaRotta &&
      l.motivi.includes('SENZA_RIGA_CER') &&
      l.righe.some(r => r.tipo === 'CER' && !r.prezzoSpeciale)
    if (righeDaScrivere.length === 0 && !famigliaRotta && !riparata) {
      out.invariati++
      continue
    }

    const righeDopo = l.righe.map(r => ({
      prezzoSpeciale: r.prezzoSpeciale,
      prezzoManuale: r.prezzoManuale,
      prezzo: dopo.has(r.id) ? dopo.get(r.id)!.prezzo : r.prezzo,
      quantita: r.quantita,
    }))
    const motiviRiga = motiviRighe(
      righeDopo.map(r => ({
        rigaAddebitoId: '',
        origine: 'PRINCIPALE' as const,
        quantitaOrigine: null,
        codiceIvaId: null,
        sconto: null,
        ...r,
      }))
    )
    const motivi = ordinaMotivi([
      ...l.motivi.filter(
        m => !MOTIVI_DELLE_RIGHE.includes(m) && !(riparata && m === 'SENZA_RIGA_CER')
      ),
      ...motiviRiga,
      ...(famigliaRotta ? (['SENZA_RIGA_CER'] as const) : []),
    ])
    const completo = l.clienteId !== null && l.contrattoId !== null && l.elencoId !== null
    const stato = statoDopoRicalcolo(l.stato, { motivi, completo }) as StatoLegame
    const avvisi = avvisiDaRighe(l.avvisi, righeDopo)
    const stessiMotivi = motivi.join() === l.motivi.join()
    const stessiAvvisi = avvisi.join() === l.avvisi.join()
    if (righeDaScrivere.length === 0 && stato === l.stato && stessiMotivi && stessiAvvisi) {
      out.invariati++
      continue
    }
    if (l.stato !== 'DA_COLLEGARE' && stato === 'DA_COLLEGARE') out.daCollegare++
    out.daScrivere.push({
      legameId: l.id,
      statoPrima: l.stato,
      stato,
      motivi,
      avvisi,
      righe: righeDaScrivere,
    })
  }
  out.firma = sha256(
    [chiavePerimetro, ...[...out.scrivibili.entries()].map(([id, d]) => `${id}:${d}`)].join('\n')
  )
  return out
}
