/**
 * Lettura comune dei use case che collegano, aprono, modificano o chiudono un registro su RENTRI
 * (eREGI E2/E3): il registro locale con la sede e il numero di iscrizione dell'operatore.
 */
import type { Prisma } from '@prisma/client'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import type { RegistroRentriAnagrafico } from './registro-rentri-anagrafico'
import {
  OperatoreRentriNonConfiguratoError,
  RegistroSenzaSedeRentriError,
} from './errori-azioni-rentri-registro'

type Tx = Prisma.TransactionClient

export interface ContestoRegistroRentri {
  registroId: string
  descrizione: string
  identificativoRentri: string | null
  numIscrSito: string
  /** `null` se l'azienda non l'ha configurato: serve solo a leggere i registri della sede. */
  numIscrOperatore: string | null
  rentriAperturaRichiestaIl: Date | null
  rentriAperturaDescrizione: string | null
  rentriAttivita: string[]
  rentriAttivitaRecSmalt: string[]
  rentriChiusoIl: Date | null
}

/**
 * @throws RegistroNonTrovatoError registro assente o di un'altra azienda
 * @throws RegistroSenzaSedeRentriError il registro non ha una sede con numero di iscrizione
 */
export async function leggiContestoRegistroRentri(
  tx: Tx,
  tenantId: string,
  registroId: string
): Promise<ContestoRegistroRentri> {
  const registro = await tx.registroRifiuti.findFirst({
    where: { id: registroId, tenantId },
    select: {
      id: true,
      descrizione: true,
      identificativoRentri: true,
      rentriAperturaRichiestaIl: true,
      rentriAperturaDescrizione: true,
      rentriAttivita: true,
      rentriAttivitaRecSmalt: true,
      rentriChiusoIl: true,
      unitaLocale: { select: { numIscrSito: true } },
    },
  })
  if (!registro) throw new RegistroNonTrovatoError()
  const numIscrSito = registro.unitaLocale?.numIscrSito?.trim()
  if (!numIscrSito) throw new RegistroSenzaSedeRentriError()
  const credenziale = await tx.rentriCredential.findFirst({
    where: { tenantId },
    select: { numIscrOperatore: true },
  })
  const numIscrOperatore = credenziale?.numIscrOperatore?.trim() || null
  return {
    registroId: registro.id,
    descrizione: registro.descrizione,
    identificativoRentri: registro.identificativoRentri,
    numIscrSito,
    numIscrOperatore,
    rentriAperturaRichiestaIl: registro.rentriAperturaRichiestaIl,
    rentriAperturaDescrizione: registro.rentriAperturaDescrizione,
    rentriAttivita: registro.rentriAttivita,
    rentriAttivitaRecSmalt: registro.rentriAttivitaRecSmalt,
    rentriChiusoIl: registro.rentriChiusoIl,
  }
}

/** Il registro di RENTRI e' chiuso (data di chiusura o stato terminale). */
export function registroRentriChiuso(r: RegistroRentriAnagrafico): boolean {
  if (typeof r.data_chiusura === 'string' && r.data_chiusura.trim() !== '') return true
  return r.stato === 'Chiuso' || r.stato === 'Eliminato'
}

/** Numero di iscrizione dell'operatore, o errore se l'azienda non lo ha configurato. */
export function richiediOperatore(contesto: ContestoRegistroRentri): string {
  if (!contesto.numIscrOperatore) throw new OperatoreRentriNonConfiguratoError()
  return contesto.numIscrOperatore
}
