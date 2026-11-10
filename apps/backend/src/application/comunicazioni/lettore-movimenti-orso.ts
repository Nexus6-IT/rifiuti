import type { Prisma } from '@prisma/client'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { cerSoloCifre } from '../../domain/waste-movement/cer-registro'
import { convertiInKg } from '../../domain/waste-movement/unita-misura-registro'
import type { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import {
  classificaMovimento,
  operazioneDelMovimento,
  type OrigineOperazione,
  type RuoloMovimento,
} from '../mud/aggregazione/mud-regole'
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
  /** Provincia del produttore dal FIR (`producerSedeId` -> `SedeDitta`); `null` se non risolvibile. */
  provinciaConferitore: string | null
}

export interface LetturaMovimentiOrso {
  /** Provincia dell'impianto (`RentriUnitaLocale.provincia`), `null` se non impostata. */
  provinciaImpianto: string | null
  movimenti: MovimentoOrso[]
}

function arrotonda3(n: number): number {
  return Math.round(n * 1000) / 1000
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
  if (registri.length === 0) return { provinciaImpianto, movimenti: [] }

  const grezzi = await db.wasteMovement.findMany({
    where: {
      tenantId: p.tenantId,
      registroId: { in: registri.map(r => r.id) },
      movementDate: { gte: p.da, lt: p.a },
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
    },
    orderBy: [{ movementDate: 'asc' }, { progressiveYear: 'asc' }, { progressiveNumber: 'asc' }],
  })

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
    const descrizione = m.wasteDescription?.trim() || null
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
      operationCode: m.operationCode,
      conFir: m.firId !== null,
      firId: m.firId,
      provinciaConferitore: f?.producerSedeId
        ? (provinciaPerSede.get(f.producerSedeId) ?? null)
        : null,
    }
  })
  return { provinciaImpianto, movimenti }
}
