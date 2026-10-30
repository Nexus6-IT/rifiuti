import type { Prisma } from '@prisma/client'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  cerCanonico,
  cerSoloCifre,
  chiaveConfrontoCer,
} from '../../domain/waste-movement/cer-registro'
import {
  famigliaFifo,
  millesimiFifo,
  quantitaFifo,
  type EventoFifo,
} from '../../domain/waste-movement/fifo-deposito'
import { leggiApertureRegistro, type ApertureRegistroRiga } from '../registro/aperture-registro'

/** Quello che serve del client Prisma: vale sia per il client base sia per una transazione. */
export interface ClientEventiDeposito {
  wasteMovement: Pick<Prisma.TransactionClient['wasteMovement'], 'findMany' | 'groupBy'>
  giacenzaIniziale: Pick<Prisma.TransactionClient['giacenzaIniziale'], 'findMany' | 'groupBy'>
  $queryRaw: Prisma.TransactionClient['$queryRaw']
}

export interface OpzioniEventiDeposito {
  /** Solo gli eventi di questo registro; senza, tutti i registri dell'azienda. */
  registroId?: string
  /** Aperture gia' lette dal chiamante (stesso filtro): evita una seconda lettura. */
  aperture?: ApertureRegistroRiga[]
  /** Per segnalare le righe storiche con quantita non utilizzabile (fuori dal dominio puro). */
  logger?: { warn(messaggio: string): void }
}

/** Eventi di un CER in un registro, divisi per famiglia di unita (kg e t insieme in 'KG'). */
export interface GruppoEventi {
  /** Forma canonica; con l'asterisco se il CER e' pericoloso (vedi `leggiEventiDeposito`). */
  cerCode: string
  pericoloso: boolean
  famiglie: Map<string, EventoFifo[]>
}

/** registroId -> chiave di confronto del CER (sole cifre) -> eventi. */
export type EventiDeposito = Map<string, Map<string, GruppoEventi>>

/**
 * Legge gli eventi (carichi, scarichi, aperture) che alimentano il FIFO del deposito, con un
 * numero fisso di query qualunque siano i registri e i CER (nessun N+1):
 *  1. una `findMany` dei movimenti vigenti;
 *  2. una lettura delle aperture;
 *  3. pericolosita: un CER e' pericoloso, uguale in tutte le sedi, se qualche riga
 *     dell'azienda lo scrive con l'asterisco oppure se il catalogo lo marca `isPericoloso`.
 *     L'asterisco si cerca SEMPRE con due `groupBy` (movimenti e aperture dell'azienda, vigenti
 *     o no), con o senza `registroId`: le righe lette sono solo le vigenti e le due viste
 *     devono dare lo stesso esito.
 *     Una sola query sul catalogo (tabella globale) per le cifre presenti.
 * Le quantita non utilizzabili (<= 0 o che arrotondano a zero in millesimi) si saltano con
 * un avviso: `calcolaFifo` le rifiuterebbe.
 */
export async function leggiEventiDeposito(
  client: ClientEventiDeposito,
  tenantId: string,
  opzioni: OpzioniEventiDeposito = {}
): Promise<EventiDeposito> {
  const { registroId, logger } = opzioni
  const perRegistro = registroId ? { registroId } : {}

  const movimenti = await client.wasteMovement.findMany({
    where: { tenantId, ...perRegistro, ...WHERE_VIGENTE },
    select: {
      id: true,
      registroId: true,
      cerCode: true,
      type: true,
      unit: true,
      quantity: true,
      movementDate: true,
      progressiveYear: true,
      progressiveNumber: true,
    },
  })
  const aperture =
    opzioni.aperture ?? (await leggiApertureRegistro(client, tenantId, { registroId }))

  // (a) asterisco in qualche riga dell'azienda
  const conAsterisco = new Set<string>()
  // Sempre i due groupBy, anche senza registroId: le righe lette sono solo le vigenti, e un
  // asterisco presente solo in una riga rettificata deve dare lo stesso esito nelle due viste.
  const [mov, ap] = await Promise.all([
    client.wasteMovement.groupBy({
      by: ['cerCode'],
      where: { tenantId, cerCode: { contains: '*' } },
    }),
    client.giacenzaIniziale.groupBy({
      by: ['cerCode'],
      where: { tenantId, cerCode: { contains: '*' } },
    }),
  ])
  for (const r of [...mov, ...ap]) conAsterisco.add(chiaveConfrontoCer(r.cerCode))

  // (b) catalogo: una sola query per le cifre presenti
  const cifre = new Set<string>()
  for (const r of [...movimenti, ...aperture]) {
    const c = cerSoloCifre(r.cerCode)
    if (c) cifre.add(c)
  }
  const dalCatalogo = new Set<string>()
  if (cifre.size > 0) {
    const elenco = [...cifre]
    const righe = await client.$queryRaw<Array<{ cifre: string; pericoloso: boolean }>>`
      SELECT regexp_replace(code, '[^0-9]', '', 'g') AS cifre, bool_or(is_pericoloso) AS pericoloso
      FROM cer_codes
      WHERE regexp_replace(code, '[^0-9]', '', 'g') = ANY(${elenco}::text[])
      GROUP BY 1`
    for (const r of righe) if (r.pericoloso) dalCatalogo.add(r.cifre)
  }

  const risultato: EventiDeposito = new Map()
  const aggiungi = (reg: string, cerCode: string, unita: string, evento: EventoFifo) => {
    const chiave = chiaveConfrontoCer(cerCode)
    let perCer = risultato.get(reg)
    if (!perCer) risultato.set(reg, (perCer = new Map()))
    let gruppo = perCer.get(chiave)
    if (!gruppo) {
      const pericoloso = conAsterisco.has(chiave) || dalCatalogo.has(chiave)
      const canonico = cerCanonico(cerCode).replace(/\*/g, '')
      gruppo = {
        cerCode: pericoloso ? `${canonico}*` : canonico,
        pericoloso,
        famiglie: new Map(),
      }
      perCer.set(chiave, gruppo)
    }
    const famiglia = famigliaFifo(unita)
    const lista = gruppo.famiglie.get(famiglia) ?? []
    lista.push(evento)
    gruppo.famiglie.set(famiglia, lista)
  }

  for (const m of movimenti) {
    const quantita = quantitaFifo(Number(m.quantity), m.unit)
    if (!(quantita > 0) || millesimiFifo(quantita) <= 0) {
      logger?.warn(`Movimento ${m.id} saltato dal FIFO del deposito: quantita non utilizzabile`)
      continue
    }
    aggiungi(m.registroId, m.cerCode, m.unit, {
      tipo: m.type === 'CARICO' ? 'CARICO' : 'SCARICO',
      giorno: giornoItaliano(m.movementDate),
      quantita,
      origine: 'MOVIMENTO',
      ordine: m.progressiveYear * 1e7 + m.progressiveNumber,
      riferimento: { id: m.id, numero: `${m.progressiveNumber}/${m.progressiveYear}` },
    })
  }
  for (const a of aperture) {
    const quantita = quantitaFifo(a.quantita, a.unita)
    const id = a.id ?? `${a.registroId}:${a.cerCode}:${a.unita}`
    if (!(quantita > 0) || millesimiFifo(quantita) <= 0) {
      logger?.warn(`Apertura ${id} saltata dal FIFO del deposito: quantita non utilizzabile`)
      continue
    }
    aggiungi(a.registroId, a.cerCode, a.unita, {
      tipo: 'CARICO',
      giorno: a.dataRiferimento,
      quantita,
      origine: 'APERTURA',
      ordine: 0,
      riferimento: { id },
    })
  }
  return risultato
}
