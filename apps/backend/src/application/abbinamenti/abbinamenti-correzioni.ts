/**
 * Effetto di rettifiche e annullamenti sugli abbinamenti carico-scarico (4.6, Task 7, D11 e D13).
 * Da chiamare DENTRO la transazione della correzione, che ha gia preso i lock del progressivo e
 * dei CER toccati (stesso ordine di `ricalcolaAbbinamenti`: nessun lock nuovo qui).
 *
 * - carico: `verificaCorrezioneCarico` PRIMA dell'insert, 409 se la correzione violerebbe I-ABB;
 * - scarico: `fotografiaScarico` PRIMA dell'insert, `riallineaDopoCorrezioneScarico` DOPO.
 */
import { ConflictException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  classeAttesaScarico,
  classeStoccaggio,
  residui,
  validaRigheManuali,
  type ClasseStoccaggio,
} from '../../domain/waste-movement/abbinamento-carichi'
import { chiaveConfrontoCer } from '../../domain/waste-movement/cer-registro'
import {
  famigliaFifo,
  millesimiFifo,
  quantitaFifo,
} from '../../domain/waste-movement/fifo-deposito'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'
import { abbinaNuovoScarico } from './abbinamenti-scrittura'
import { leggiAmbitiAbbinamento, righeDelCarico } from './lettore-abbinamenti'

export type TipoCorrezioneAbbinamenti = 'RETTIFICA' | 'ANNULLAMENTO'

export interface StatoScarico {
  giorno: string
  chiaveCer: string
  famiglia: string
  quantita: number
  classeAttesa: ClasseStoccaggio | null
}

/** Ordine di ricerca della testa corrente di una catena: l'ultima annotazione numerata. */
const ORDINE_TESTA = [{ progressiveYear: 'desc' }, { progressiveNumber: 'desc' }] as const

const numeroDi = (m: { progressiveNumber: number; progressiveYear: number }): string =>
  `${m.progressiveNumber}/${m.progressiveYear}`

/** Un registro di sola lettura delle righe di una catena: radice o discendenti. */
function catena(radiceId: string): Prisma.WasteMovementWhereInput {
  return { OR: [{ id: radiceId }, { movimentoOriginaleId: radiceId }] }
}

// ---------------------------------------------------------------------------------------------
// Carico
// ---------------------------------------------------------------------------------------------

/** Prima dell'insert di una correzione di CARICO: ConflictException col testo di D13 se viola I-ABB. */
export async function verificaCorrezioneCarico(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string
    caricoRadiceId: string
    numeroCarico: string
    tipo: TipoCorrezioneAbbinamenti
    nuovo?: {
      giorno: string
      chiaveCer: string
      famiglia: string
      /** nella scala della famiglia (kg per la massa) */
      quantita: number
      classe: ClasseStoccaggio | null
    }
  }
): Promise<void> {
  const righe = await righeDelCarico(tx, p.tenantId, p.caricoRadiceId)
  if (righe.length === 0) return

  const perScarico = new Map<string, string>()
  for (const r of righe) perScarico.set(r.scaricoRadiceId, r.numeroScarico)
  const numeri = [...perScarico.values()]
  const elenco =
    numeri.length > 5
      ? `${numeri.slice(0, 5).join(', ')} e altri ${numeri.length - 5}`
      : numeri.join(', ')
  const rifiuta = (motivo: string): never => {
    throw new ConflictException(
      `Il carico n. ${p.numeroCarico} è abbinato agli scarichi n. ${elenco}: ${motivo}. ` +
        "Modifica prima l'abbinamento di quegli scarichi (Giacenze → Abbinamenti)."
    )
  }

  if (p.tipo === 'ANNULLAMENTO') return rifiuta('non si può annullare')
  if (!p.nuovo) return

  // stato attuale del carico (la testa prima dell'insert)
  const testa = await tx.wasteMovement.findFirst({
    where: { tenantId: p.tenantId, ...catena(p.caricoRadiceId) },
    orderBy: [...ORDINE_TESTA],
    select: { cerCode: true, unit: true, operationCode: true },
  })
  const famigliaRighe = righe[0].famiglia
  if (
    p.nuovo.famiglia !== famigliaRighe ||
    (testa && chiaveConfrontoCer(testa.cerCode) !== p.nuovo.chiaveCer) ||
    (testa && classeStoccaggio(testa.operationCode) !== p.nuovo.classe)
  ) {
    return rifiuta("cambia il rifiuto, l'unità o l'operazione di stoccaggio")
  }

  const abbinato = righe.reduce((s, r) => s + millesimiFifo(r.quantita), 0)
  if (millesimiFifo(p.nuovo.quantita) < abbinato) {
    return rifiuta(
      `la nuova quantità è inferiore a quella già abbinata (${formattaQuantita(abbinato / 1000)})`
    )
  }
  if (righe.some(r => r.giornoScarico < (p.nuovo as { giorno: string }).giorno)) {
    return rifiuta('la nuova data è successiva a quella di uno scarico che lo usa')
  }
}

// ---------------------------------------------------------------------------------------------
// Scarico
// ---------------------------------------------------------------------------------------------

/**
 * Dati dell'annotazione che contano per l'abbinamento, da leggere PRIMA dell'insert della
 * correzione. `null` se lo scarico non ha righe (il riallineamento non serve).
 */
export async function fotografiaScarico(
  tx: Prisma.TransactionClient,
  tenantId: string,
  m: {
    movementDate: Date
    cerCode: string
    unit: string
    quantity: Prisma.Decimal | number | string
    operationCode: string | null
    causale: string
    causaleAziendaId: string | null
  },
  tipo: TipoCorrezioneAbbinamenti,
  scaricoRadiceId: string
): Promise<StatoScarico | null> {
  // senza righe non c'e nulla da riallineare: niente lettura del catalogo
  const nRighe = await tx.abbinamentoCaricoScarico.count({
    where: { tenantId, scaricoId: scaricoRadiceId },
  })
  if (nRighe === 0) return null
  const giorno = giornoItaliano(m.movementDate)
  // l'annullamento non confronta nulla: niente lettura del catalogo nella transazione
  const catalogo = tipo === 'RETTIFICA' ? await caricaCatalogoCausali(tx, tenantId) : null
  const operazione =
    catalogo?.comportamento('SCARICO', m.causale, giorno, m.causaleAziendaId)?.operazione ?? null
  return {
    giorno,
    chiaveCer: chiaveConfrontoCer(m.cerCode),
    famiglia: famigliaFifo(m.unit),
    quantita: quantitaFifo(Number(m.quantity), m.unit),
    classeAttesa: classeAttesaScarico(m.operationCode, operazione),
  }
}

/** Dopo l'insert di una correzione di SCARICO (la nuova testa e' gia' scritta): D11. */
export async function riallineaDopoCorrezioneScarico(
  tx: Prisma.TransactionClient,
  p: {
    tenantId: string
    registroId: string
    scaricoRadiceId: string
    tipo: TipoCorrezioneAbbinamenti
    prima: {
      giorno: string
      chiaveCer: string
      famiglia: string
      quantita: number
      classeAttesa: ClasseStoccaggio | null
    }
    userId: string | null
  }
): Promise<string[]> {
  const righe = await tx.abbinamentoCaricoScarico.findMany({
    where: { tenantId: p.tenantId, scaricoId: p.scaricoRadiceId },
    select: { id: true, origine: true, quantita: true, caricoId: true, giacenzaInizialeId: true },
  })
  if (righe.length === 0) return []
  const ids = righe.map(r => r.id)

  if (p.tipo === 'ANNULLAMENTO') {
    const radice = await tx.wasteMovement.findFirst({
      where: { id: p.scaricoRadiceId, tenantId: p.tenantId },
      select: { progressiveNumber: true, progressiveYear: true },
    })
    const caricoIds = righe.map(r => r.caricoId).filter((x): x is string => x !== null)
    const carichi = caricoIds.length
      ? await tx.wasteMovement.findMany({
          where: { tenantId: p.tenantId, id: { in: caricoIds } },
          select: { id: true, progressiveNumber: true, progressiveYear: true },
        })
      : []
    const etichetta = new Map(carichi.map(c => [c.id, numeroDi(c)]))
    await tx.abbinamentoCaricoScarico.deleteMany({ where: { id: { in: ids } } })
    const nCarichi = new Set(righe.map(r => r.caricoId ?? `A:${r.giacenzaInizialeId}`)).size
    await tx.activityLog.create({
      data: {
        tenantId: p.tenantId,
        userId: p.userId,
        action: 'ABBINAMENTI_LIBERATI',
        description: `Abbinamenti dello scarico${radice ? ` n. ${numeroDi(radice)}` : ''} liberati dall'annullamento: ${righe.length} righe`,
        metadata: {
          scarico: radice ? numeroDi(radice) : null,
          righe: righe.map(r => ({
            carico: r.caricoId ? (etichetta.get(r.caricoId) ?? null) : 'giacenza iniziale',
            quantita: Number(r.quantita),
            origine: r.origine,
          })),
        },
      },
    })
    return [
      nCarichi === 1
        ? 'Abbinamenti liberati: 1 carico torna disponibile.'
        : `Abbinamenti liberati: ${nCarichi} carichi tornano disponibili.`,
    ]
  }

  // RETTIFICA: la testa e' l'ultima annotazione della catena (appena scritta)
  const testa = await tx.wasteMovement.findFirst({
    where: { tenantId: p.tenantId, registroId: p.registroId, ...catena(p.scaricoRadiceId) },
    orderBy: [...ORDINE_TESTA],
    select: { id: true, cerCode: true },
  })
  if (!testa) return []
  const ambiti = await leggiAmbitiAbbinamento(tx, p.tenantId, {
    registroId: p.registroId,
    cer: testa.cerCode,
  })
  const a = ambiti.find(x => x.scarichi.some(s => s.radiceId === p.scaricoRadiceId))
  const s = a?.scarichi.find(x => x.radiceId === p.scaricoRadiceId)
  if (!a || !s) return []

  const invariato =
    s.evento.giorno === p.prima.giorno &&
    a.chiaveCer === p.prima.chiaveCer &&
    a.famiglia === p.prima.famiglia &&
    millesimiFifo(s.evento.quantita) === millesimiFifo(p.prima.quantita) &&
    s.classeAttesa === p.prima.classeAttesa
  if (invariato) return []

  const conManuali = righe.some(r => r.origine === 'MANUALE')
  if (conManuali && a.chiaveCer === p.prima.chiaveCer && a.famiglia === p.prima.famiglia) {
    const rimasti = residui(
      a.carichi,
      a.righeValide.filter(r => r.scaricoRadiceId !== p.scaricoRadiceId)
    )
    const esito = validaRigheManuali({
      scarico: s,
      righe: righe.map(r => ({
        carico: r.caricoId ? `M:${r.caricoId}` : `A:${r.giacenzaInizialeId}`,
        quantita: Number(r.quantita),
      })),
      candidati: a.carichi,
      residuoEsclusoScarico: rimasti,
    })
    if (esito.errori.length === 0) return esito.avvisi
  }

  // righe tutte automatiche, o manuali non piu valide: si cancellano e si riconta col FIFO
  await tx.abbinamentoCaricoScarico.deleteMany({ where: { id: { in: ids } } })
  const avvisiFifo = await abbinaNuovoScarico(tx, {
    tenantId: p.tenantId,
    registroId: p.registroId,
    scaricoId: testa.id,
    userId: p.userId,
  })
  const nuove = await tx.abbinamentoCaricoScarico.count({
    where: { tenantId: p.tenantId, scaricoId: p.scaricoRadiceId },
  })
  await tx.activityLog.create({
    data: {
      tenantId: p.tenantId,
      userId: p.userId,
      action: 'ABBINAMENTO_SCARICO_RICALCOLATO',
      description: `Abbinamento dello scarico n. ${s.numero} ricalcolato dopo la rettifica: ${righe.length} righe sostituite da ${nuove}`,
      metadata: {
        scarico: s.numero,
        cerCode: a.cerCode,
        righePrecedenti: righe.length,
        righeNuove: nuove,
        eraManuale: conManuali,
      },
    },
  })
  return [
    conManuali
      ? "L'abbinamento manuale non era più valido: ricalcolato con FIFO, verificalo."
      : 'Abbinamento ricalcolato con FIFO.',
    ...avvisiFifo,
  ]
}

// ---------------------------------------------------------------------------------------------
// Giacenza iniziale
// ---------------------------------------------------------------------------------------------

/** True se la giacenza iniziale e usata da almeno una riga di abbinamento. */
export async function giacenzaInizialeAbbinata(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string
): Promise<boolean> {
  return (
    (await tx.abbinamentoCaricoScarico.count({ where: { tenantId, giacenzaInizialeId: id } })) > 0
  )
}
