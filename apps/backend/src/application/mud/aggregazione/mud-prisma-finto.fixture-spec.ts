import { WHERE_VIGENTE } from '../../../domain/waste-movement/vigenza'
import { righeCausaliSistema } from '../../registro/causali/catalogo-causali.fixture'

/**
 * Prisma finto per gli spec di equivalenza del MUD (F2-8, vincoli globali del piano).
 *
 * Non e' un `mockResolvedValue` per metodo: calcola davvero dai dati. I movimenti portano
 * `vigente` (predefinito `true`) e il finto li scarta quando il `where` contiene le chiavi di
 * `WHERE_VIGENTE`; `groupBy` somma i movimenti rispettando `args.by`, `where.movementDate.lt`
 * e la vigenza; `findMany` distingue le query del servizio dal loro `where`.
 *
 * Il file finisce in `fixture-spec.ts` (non `.spec.ts`): jest non lo esegue, tsc non lo compila.
 */
export interface MovimentoFinto {
  registroId: string
  progressiveNumber: number
  progressiveYear: number
  type: string
  causale: string
  causaleAziendaId: string | null
  cerCode: string
  quantity: number
  unit: string | null
  operationCode: string | null
  firId: string | null
  firIdRicopia: string | null
  ricopiaChiave: string
  counterpartName: string | null
  wastePhysicalState: string | null
  movementDate: Date
  /** falso = annullato o rettificato: il finto lo scarta se la query chiede i vigenti */
  vigente?: boolean
}

export interface FirFinto {
  id: string
  firNumber: string | null
  rentriNumeroFir: string | null
  status: string
  rentriStatoFormulario: string | null
  wasteOperationType: string | null
  wasteOperationCode: string | null
  receiverId: string | null
  receiverName: string | null
  receiverPartitaIva: string | null
  carrierId: string | null
  carrierName: string | null
  carrierPartitaIva: string | null
}

export interface DatiPrismaFinto {
  movimenti?: MovimentoFinto[]
  fir?: FirFinto[]
  /** FIR emessi con trasporto nell'anno (la query `firAnno` del servizio) */
  firAnno?: Array<{ id: string; firNumber: string | null; rentriNumeroFir: string | null }>
  destinatari?: any[]
  trasportatori?: any[]
  registri?: Array<{
    id: string
    descrizione: string
    unitaLocale?: { denominazione: string } | null
  }>
  unitaLocali?: Array<{ denominazione: string; numIscrSito: string; principale: boolean }>
  giacenzeIniziali?: Array<{
    registroId: string
    cerCode: string
    quantita: number
    unita: string
    dataRiferimento: Date
  }>
  tenant?: Record<string, unknown> | null
  reportData?: unknown
  causaliAzienda?: any[]
  autorizzazioni?: number
}

const CHIAVI_VIGENTE = Object.keys(WHERE_VIGENTE)

const chiedeVigenti = (where: Record<string, unknown> | undefined): boolean =>
  !!where && CHIAVI_VIGENTE.every(k => k in where)

const ordina = (a: MovimentoFinto, b: MovimentoFinto): number =>
  a.movementDate.getTime() - b.movementDate.getTime() ||
  a.progressiveYear - b.progressiveYear ||
  a.progressiveNumber - b.progressiveNumber

/** Toglie il campo di servizio `vigente`: il database non lo restituisce. */
const pulito = ({ vigente: _v, ...m }: MovimentoFinto) => m

export function creaPrismaFinto(d: DatiPrismaFinto = {}): any {
  const movimenti = d.movimenti ?? []
  const fir = d.fir ?? []

  const filtra = (where: any): MovimentoFinto[] =>
    movimenti.filter(m => {
      if (chiedeVigenti(where) && m.vigente === false) return false
      if (where.tenantId !== undefined && where.tenantId !== 't1') return false
      if (where.type !== undefined && m.type !== where.type) return false
      if (where.firId?.in && !where.firId.in.includes(m.firId)) return false
      const dt = where.movementDate
      if (dt?.gte && m.movementDate < dt.gte) return false
      if (dt?.lt && !(m.movementDate < dt.lt)) return false
      return true
    })

  return {
    wasteMovement: {
      findMany: async (args: any) => {
        const trovati = filtra(args.where).sort(ordina)
        if (args.select && Object.keys(args.select).length === 1 && args.select.firId) {
          return trovati.map(m => ({ firId: m.firId }))
        }
        return trovati.map(pulito)
      },
      groupBy: async (args: any) => {
        const per = args.by as string[]
        const gruppi = new Map<string, any>()
        for (const m of filtra(args.where)) {
          const chiave = per.map(k => String((m as any)[k])).join('|')
          const g =
            gruppi.get(chiave) ??
            Object.assign(Object.fromEntries(per.map(k => [k, (m as any)[k]])), {
              _sum: { quantity: 0 },
            })
          g._sum.quantity += m.quantity
          gruppi.set(chiave, g)
        }
        return [...gruppi.values()]
      },
    },
    fIR: {
      findMany: async (args: any) => {
        if (args.where?.id?.in) return fir.filter(f => args.where.id.in.includes(f.id))
        if (args.where?.status) return d.firAnno ?? []
        return []
      },
    },
    tenant: {
      findUnique: async () =>
        d.tenant === undefined ? { city: 'Roma', province: 'RM', atecoCode: '38.11.00' } : d.tenant,
    },
    rentriUnitaLocale: {
      findMany: async () =>
        d.unitaLocali ?? [{ denominazione: 'Sede', numIscrSito: 'OP1', principale: true }],
    },
    mUDReport: {
      findUnique: async () => (d.reportData === undefined ? null : { reportData: d.reportData }),
    },
    registroRifiuti: { findMany: async () => d.registri ?? [] },
    giacenzaIniziale: {
      findMany: async (args: any) => {
        const lte: Date | undefined = args?.where?.dataRiferimento?.lte
        return (d.giacenzeIniziali ?? []).filter(g => !lte || g.dataRiferimento <= lte)
      },
    },
    autorizzazioneImpianto: { count: async () => d.autorizzazioni ?? 0 },
    causaleRegistro: { findMany: async () => righeCausaliSistema() },
    causaleRegistroAzienda: { findMany: async () => d.causaliAzienda ?? [] },
    destinatario: {
      findMany: async (args: any) =>
        (d.destinatari ?? []).filter(x => args.where.id.in.includes(x.id)),
    },
    trasportatore: {
      findMany: async (args: any) =>
        (d.trasportatori ?? []).filter(x => args.where.id.in.includes(x.id)),
    },
  }
}
