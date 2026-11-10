import type { Prisma } from '@prisma/client'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { cerSoloCifre } from '../../domain/waste-movement/cer-registro'
import { convertiInKg } from '../../domain/waste-movement/unita-misura-registro'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import {
  classificaMovimento,
  operazioneDelMovimento,
  type OrigineOperazione,
  type RuoloMovimento,
} from '../mud/aggregazione/mud-regole'
import {
  apertureInKg,
  leggiApertureRegistro,
  type ClientApertureRegistro,
} from '../registro/aperture-registro'
import { chiavePesoSpecifico, type IntegrazioniMud } from '../mud/aggregazione/mud-integrazioni'

/**
 * Lettore dei movimenti vigenti di una sede per la comunicazione O.R.SO. (PR 4.9a, T3).
 *
 * Legge soltanto: nessuna tabella nuova. Restituisce i movimenti vigenti (`WHERE_VIGENTE`: le
 * rettifiche sostituiscono la precedente, gli annullamenti tolgono la catena) dei registri della
 * sede nel periodo, già arricchiti con quanto l'aggregatore puro non può leggere da solo:
 * ruolo nel MUD, operazione R/D, kg, provincia del conferitore. Non filtra per ruolo né scarta
 * unità non convertibili: i dati mancanti restano espliciti (`null`) e li giudica il servizio.
 */

/** Cosa legge il lettore di `PrismaService`/`Prisma.TransactionClient`. */
export interface LettoreDatabaseOrso {
  registroRifiuti: {
    findMany(args: Prisma.RegistroRifiutiFindManyArgs): Promise<Array<{ id: string }>>
  }
  rentriUnitaLocale: {
    findFirst(args: Prisma.RentriUnitaLocaleFindFirstArgs): Promise<{
      provincia: string | null
    } | null>
  }
  wasteMovement: {
    findMany(args: Prisma.WasteMovementFindManyArgs): Promise<MovimentoGrezzo[]>
  }
  fIR: {
    findMany(args: Prisma.FIRFindManyArgs): Promise<FirGrezzo[]>
  }
  sedeDitta: {
    findMany(args: Prisma.SedeDittaFindManyArgs): Promise<Array<{ id: string; provincia: string }>>
  }
  cERCode: {
    findMany(
      args: Prisma.CERCodeFindManyArgs
    ): Promise<Array<{ code: string; description: string }>>
  }
  giacenzaIniziale: ClientApertureRegistro['giacenzaIniziale']
}

interface MovimentoGrezzo {
  id: string
  registroId: string
  type: string
  causale: string
  causaleAziendaId: string | null
  cerCode: string
  wasteDescription: string | null
  quantity: Prisma.Decimal | number | string
  unit: string | null
  operationCode: string | null
  firId: string | null
  movementDate: Date
  counterpartAddress: string | null
  progressiveYear: number
  progressiveNumber: number
}

interface FirGrezzo {
  id: string
  producerSedeId: string | null
  wasteOperationCode: string | null
  wasteOperationType: string | null
}

export interface ParametriLetturaOrso {
  tenantId: string
  /** Sede (`RentriUnitaLocale`) di cui si comunicano i movimenti. */
  unitaLocaleId: string
  /** Inizio incluso e fine ESCLUSA del periodo, sulla data del movimento. */
  da: Date
  a: Date
  catalogo: CatalogoCausali
  /** Pesi specifici del MUD per le unità non di massa; assenti = nessuna conversione. */
  pesiSpecifici?: IntegrazioniMud['pesiSpecifici']
  /** Anno solare di `da`: se presente si calcolano le giacenze a fine mese (12 mesi). */
  anno?: number
}

export interface MovimentoOrso {
  id: string
  registroId: string
  tipo: 'CARICO' | 'SCARICO'
  movementDate: Date
  /** Le sole cifre del CER (6 se ben formato). */
  cer: string
  pericoloso: boolean
  /** Descrizione del rifiuto, ripulita; `null` se vuota. */
  descrizione: string | null
  quantita: number
  unita: string | null
  /** Quantità in kg (peso specifico per le unità non di massa); `null` se non convertibile. */
  kg: number | null
  ruolo: RuoloMovimento
  operazione: 'R' | 'D'
  origineOperazione: OrigineOperazione
  /** Codice R/D completo del movimento, se indicato. */
  operationCode: string | null
  /** Vero se il movimento ha un FIR collegato (`f="1"`). */
  conFir: boolean
  firId: string | null
  /**
   * Provincia del produttore dal FIR (`producerSedeId` -> `SedeDitta`) o, in mancanza, dalla
   * sigla fra parentesi dell'indirizzo della controparte («... Bergamo (BG)»); `null` se non
   * risolvibile.
   */
  provinciaConferitore: string | null
  /** Vero se la provincia viene dall'indirizzo e non dal FIR: da segnalare come avviso. */
  provinciaDaIndirizzo: boolean
  /** Numero progressivo nel registro, «n/anno», per riconoscere il movimento. */
  numero: string
}

/** Giacenza del CER a fine mese (kg), da aperture e movimenti vigenti dei registri della sede. */
export interface GiacenzaFineMese {
  mese: number
  /** Le sole cifre del CER. */
  cer: string
  /** Ultima descrizione del CER nell'anno, o quella del catalogo; null se nessuna. */
  descrizione: string | null
  kg: number
}

export interface LetturaMovimentiOrso {
  giacenze: GiacenzaFineMese[]
  /** Provincia dell'impianto (`RentriUnitaLocale.provincia`), `null` se non impostata. */
  provinciaImpianto: string | null
  movimenti: MovimentoOrso[]
}

function arrotonda3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Sigla di provincia fra parentesi in fondo all'indirizzo, «Via Roma 1, Bergamo (BG)». */
export function siglaDaIndirizzo(indirizzo: string | null): string | null {
  const m = /\(([A-Za-z]{2})\)\s*$/.exec((indirizzo ?? '').trim())
  return m ? m[1].toUpperCase() : null
}

/**
 * Giacenza a fine mese per CER (guida O.R.SO. v2.5, pag. 17: `QuantitaTrattataInternamente` è la
 * giacenza a fine mese): aperture del registro fino a quel mese + carichi - scarichi vigenti, dal
 * principio e non solo dall'anno. I movimenti precedenti all'apertura dello stesso registro e CER
 * non contano (l'apertura li assorbe). Unità non convertibili in kg non entrano.
 */
async function calcolaGiacenze(
  db: LettoreDatabaseOrso,
  p: ParametriLetturaOrso,
  registri: ReadonlyArray<{ id: string }>,
  tutti: ReadonlyArray<MovimentoGrezzo>
): Promise<GiacenzaFineMese[]> {
  const anno = p.anno as number
  const ids = new Set(registri.map(r => r.id))
  const aperture = (
    await leggiApertureRegistro(db, p.tenantId, { finoAl: `${anno}-12-31` })
  ).filter(a => ids.has(a.registroId))
  // Eventi in kg con il giorno italiano: +apertura, +carico, -scarico.
  const eventi: Array<{ cer: string; giorno: string; kg: number }> = []
  const inizioApertura = new Map<string, string>()
  for (const a of aperture) {
    const kg = apertureInKg(a)
    if (kg === null) continue
    const cer = cerSoloCifre(a.cerCode)
    eventi.push({ cer, giorno: a.dataRiferimento, kg })
    const k = `${a.registroId}|${cer}`
    const prima = inizioApertura.get(k)
    if (prima === undefined || a.dataRiferimento < prima) inizioApertura.set(k, a.dataRiferimento)
  }
  for (const m of tutti) {
    const cer = cerSoloCifre(m.cerCode)
    const giorno = giornoItaliano(m.movementDate)
    const apertura = inizioApertura.get(`${m.registroId}|${cer}`)
    if (apertura !== undefined && giorno < apertura) continue
    const q = Number(m.quantity)
    let kg = convertiInKg(q, m.unit)
    if (kg === null) {
      const peso = p.pesiSpecifici?.[chiavePesoSpecifico(cer, m.unit ?? '')]
      kg = peso ? q * peso.kgPerUnita : null
    }
    if (kg === null) continue
    eventi.push({ cer, giorno, kg: m.type === 'SCARICO' ? -kg : kg })
  }

  // Descrizione del CER: l'ultima dei movimenti (anche di anni precedenti), altrimenti quella
  // del catalogo.
  const descrizioni = new Map<string, string>()
  for (const m of tutti) {
    const d = m.wasteDescription?.trim()
    if (d) descrizioni.set(cerSoloCifre(m.cerCode), d.slice(0, 100))
  }
  const mancanti = [...new Set(eventi.map(e => e.cer))].filter(c => !descrizioni.has(c))
  if (mancanti.length > 0) {
    const cat = await db.cERCode.findMany({
      select: { code: true, description: true },
      where: { OR: mancanti.map(c => ({ code: { startsWith: c.slice(0, 2) } })) },
    })
    for (const c of cat) {
      const cifre = cerSoloCifre(c.code)
      if (mancanti.includes(cifre) && !descrizioni.has(cifre)) {
        descrizioni.set(cifre, c.description.trim().slice(0, 100))
      }
    }
  }

  const perCer = new Map<string, Array<{ giorno: string; kg: number }>>()
  for (const e of eventi) {
    const l = perCer.get(e.cer) ?? []
    l.push(e)
    perCer.set(e.cer, l)
  }
  const out: GiacenzaFineMese[] = []
  for (const [cer, lista] of [...perCer.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (let mese = 1; mese <= 12; mese++) {
      const fine = `${anno}-${String(mese).padStart(2, '0')}-31` // confronto lessicografico: basta
      const kg = lista.filter(e => e.giorno <= fine).reduce((t, e) => t + e.kg, 0)
      out.push({
        mese,
        cer,
        descrizione: descrizioni.get(cer) ?? null,
        kg: Math.round(kg * 1000) / 1000,
      })
    }
  }
  return out
}

export async function leggiMovimentiOrso(
  db: LettoreDatabaseOrso,
  p: ParametriLetturaOrso
): Promise<LetturaMovimentiOrso> {
  const [registri, sede] = await Promise.all([
    db.registroRifiuti.findMany({
      where: { tenantId: p.tenantId, unitaLocaleId: p.unitaLocaleId },
      select: { id: true },
    }),
    db.rentriUnitaLocale.findFirst({
      where: { id: p.unitaLocaleId, tenantId: p.tenantId },
      select: { provincia: true },
    }),
  ])
  const provinciaImpianto = sede?.provincia ?? null
  if (registri.length === 0) return { provinciaImpianto, movimenti: [], giacenze: [] }

  const tutti = await db.wasteMovement.findMany({
    where: {
      tenantId: p.tenantId,
      registroId: { in: registri.map(r => r.id) },
      // Con `anno` serve anche la storia precedente, per la giacenza a fine mese.
      movementDate: p.anno === undefined ? { gte: p.da, lt: p.a } : { lt: p.a },
      ...WHERE_VIGENTE,
    },
    select: {
      id: true,
      registroId: true,
      type: true,
      causale: true,
      causaleAziendaId: true,
      cerCode: true,
      wasteDescription: true,
      quantity: true,
      unit: true,
      operationCode: true,
      firId: true,
      movementDate: true,
      counterpartAddress: true,
      progressiveYear: true,
      progressiveNumber: true,
    },
    orderBy: [{ movementDate: 'asc' }, { progressiveYear: 'asc' }, { progressiveNumber: 'asc' }],
  })

  const grezzi = tutti.filter(m => m.movementDate >= p.da)
  const firIds = [...new Set(grezzi.map(m => m.firId).filter((id): id is string => id !== null))]
  const fir = firIds.length
    ? await db.fIR.findMany({
        where: { tenantId: p.tenantId, id: { in: firIds } },
        select: {
          id: true,
          producerSedeId: true,
          wasteOperationCode: true,
          wasteOperationType: true,
        },
      })
    : []
  const firPerId = new Map(fir.map(f => [f.id, f]))
  const sedeIds = [...new Set(fir.map(f => f.producerSedeId).filter((id): id is string => !!id))]
  const sedi = sedeIds.length
    ? await db.sedeDitta.findMany({
        where: { tenantId: p.tenantId, id: { in: sedeIds } },
        select: { id: true, provincia: true },
      })
    : []
  const provinciaPerSede = new Map(sedi.map(s => [s.id, s.provincia]))

  // Descrizione vuota: ripiego sul catalogo CER (tagliata a 100 caratteri come l'XSD).
  const senzaDescrizione = [
    ...new Set(grezzi.filter(m => !m.wasteDescription?.trim()).map(m => m.cerCode)),
  ]
  const catalogoCer = senzaDescrizione.length
    ? await db.cERCode.findMany({
        where: { code: { in: senzaDescrizione } },
        select: { code: true, description: true },
      })
    : []
  const descrizionePerCer = new Map(catalogoCer.map(c => [c.code, c.description.trim()]))

  const movimenti = grezzi.map((m): MovimentoOrso => {
    const tipo = m.type === 'SCARICO' ? 'SCARICO' : 'CARICO'
    const quantita = Number(m.quantity)
    const f = m.firId ? firPerId.get(m.firId) : undefined
    const cer = cerSoloCifre(m.cerCode)
    let kg = convertiInKg(quantita, m.unit)
    if (kg === null) {
      const peso = p.pesiSpecifici?.[chiavePesoSpecifico(cer, m.unit ?? '')]
      kg = peso ? arrotonda3(quantita * peso.kgPerUnita) : null
    }
    const op = operazioneDelMovimento(p.catalogo, m, f)
    const descrizione =
      m.wasteDescription?.trim() || descrizionePerCer.get(m.cerCode)?.slice(0, 100) || null
    const provinciaFir = f?.producerSedeId ? (provinciaPerSede.get(f.producerSedeId) ?? null) : null
    const provinciaIndirizzo = provinciaFir ? null : siglaDaIndirizzo(m.counterpartAddress)
    return {
      id: m.id,
      registroId: m.registroId,
      tipo,
      movementDate: m.movementDate,
      cer,
      pericoloso: m.cerCode.includes('*'),
      descrizione,
      quantita,
      unita: m.unit,
      kg,
      ruolo: classificaMovimento(p.catalogo, m),
      operazione: op.operazione,
      origineOperazione: op.origine,
      operationCode: m.operationCode?.trim() || f?.wasteOperationCode?.trim() || null,
      conFir: m.firId !== null,
      firId: m.firId,
      provinciaConferitore: provinciaFir ?? provinciaIndirizzo,
      provinciaDaIndirizzo: provinciaFir === null && provinciaIndirizzo !== null,
      numero: `${m.progressiveNumber}/${m.progressiveYear}`,
    }
  })
  const giacenze = p.anno === undefined ? [] : await calcolaGiacenze(db, p, registri, tutti)
  return { provinciaImpianto, movimenti, giacenze }
}
