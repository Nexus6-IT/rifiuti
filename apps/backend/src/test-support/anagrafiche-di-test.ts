import { Prisma, PrismaClient } from '@prisma/client'

/**
 * Dati fiscali validi per i test delle anagrafiche (F2-10). Servono perche' l'applicazione
 * controlla il checksum quando un identificativo viene impostato: una P.IVA "di comodo" come
 * `12345678901` verrebbe rifiutata.
 */

/** Partita IVA con checksum valido. */
export const PIVA_VALIDA = '12345678903'

/** Codice fiscale di persona fisica con carattere di controllo valido. */
export const CF_PERSONA_VALIDO = 'RSSMRA80A01H501U'

/** Stesso codice fiscale scritto con l'omocodia (cifre sostituite da lettere). */
export const CF_PERSONA_OMOCODICO = 'RSSMRA80A01H5RMD'

/** Un secondo codice fiscale valido, diverso dal primo. */
export const CF_PERSONA_ALTRO = 'BNCLRA85M41F205C'

/**
 * Partita IVA valida derivata da un seme numerico (matricola di 7 cifre piu' codice ufficio
 * `000`, poi la cifra di controllo). Semi diversi danno P.IVA diverse.
 */
export function partitaIvaValida(seme: number): string {
  const nove = String(Math.abs(Math.trunc(seme)) % 10_000_000).padStart(7, '0') + '000'
  const cifre = nove.split('').map(Number)
  let somma = 0
  for (let i = 0; i < 10; i++) {
    let c = cifre[i]
    if (i % 2 !== 0) {
      c *= 2
      if (c > 9) c -= 9
    }
    somma += c
  }
  return nove + String((10 - (somma % 10)) % 10)
}

/** Partita IVA di 11 cifre con checksum SBAGLIATO (per i dati "da verificare"). */
export const PIVA_CHECKSUM_ERRATO = '12345678901'

// ---------------------------------------------------------------------------------------------
// Fixture del database: una ditta con la sua sede e UNA riga di ruolo (F2-10 Task 3a).
// ---------------------------------------------------------------------------------------------

export interface DatiDittaDiTest {
  ragioneSociale?: string
  partitaIva?: string | null
  codiceFiscale?: string | null
  via?: string
  civico?: string
  cap?: string
  comune?: string
  provincia?: string
  email?: string | null
  telefono?: string | null
  pec?: string | null
  /**
   * Ragione sociale congelata sulla riga di ruolo, come l'hanno le righe migrate (D6/I2). Le righe
   * create dopo il deploy non l'hanno (NULL): e' il default.
   */
  ragioneSocialeStorica?: string | null
  /** Numero di iscrizione (trasportatore) o di autorizzazione (destinatario). */
  numeroDocumento?: string
}

export interface RisultatoDittaConRuolo {
  dittaId: string
  sedeId: string
  ruoloId: string
}

let contatore = 0

/**
 * Crea ditta, sede principale e riga di ruolo. Le colonne vecchie della riga di ruolo (ragione
 * sociale, P.IVA, indirizzo, contatti) sono congelate (D6): non si scrivono. Va chiamata con un client che
 * puo' scrivere (proprietario o `tx`); il `tenantId` e' esplicito perche' non c'e' un contesto.
 */
export async function creaDittaConRuolo(
  client: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  ruolo: 'PRODUTTORE' | 'TRASPORTATORE' | 'DESTINATARIO' | 'CLIENTE' | 'AGENTE',
  dati: DatiDittaDiTest = {}
): Promise<RisultatoDittaConRuolo> {
  const n = ++contatore
  const partitaIva =
    dati.partitaIva === undefined ? partitaIvaValida(Date.now() + n) : dati.partitaIva
  const sede = {
    via: dati.via ?? 'Via Roma',
    civico: dati.civico ?? '1',
    cap: dati.cap ?? '00100',
    comune: dati.comune ?? 'Roma',
    provincia: dati.provincia ?? 'RM',
  }
  const contatti = {
    email: dati.email ?? null,
    telefono: dati.telefono ?? null,
    pec: dati.pec ?? null,
  }
  const ragioneSociale = dati.ragioneSociale ?? `Ditta di test ${n}`

  const ditta = await client.ditta.create({
    data: { tenantId, ragioneSociale, partitaIva, codiceFiscale: dati.codiceFiscale ?? null },
  })
  const sedeCreata = await client.sedeDitta.create({
    data: { tenantId, dittaId: ditta.id, ...sede, ...contatti, principale: true },
  })
  const comuni = {
    tenantId,
    dittaId: ditta.id,
    sedeId: sedeCreata.id,
    ragioneSocialeStorica: dati.ragioneSocialeStorica ?? null,
  }
  let ruoloId: string
  if (ruolo === 'PRODUTTORE') {
    ruoloId = (await client.produttore.create({ data: comuni })).id
  } else if (ruolo === 'TRASPORTATORE') {
    ruoloId = (
      await client.trasportatore.create({
        data: { ...comuni, numeroIscrizione: dati.numeroDocumento ?? `ALBO-${n}` },
      })
    ).id
  } else if (ruolo === 'CLIENTE' || ruolo === 'AGENTE') {
    // Niente `ragioneSocialeStorica` ne' numero di documento: i due modelli non li hanno (D6).
    const { ragioneSocialeStorica: _storica, ...base } = comuni
    ruoloId =
      ruolo === 'CLIENTE'
        ? (await client.cliente.create({ data: base })).id
        : (await client.agente.create({ data: base })).id
  } else {
    ruoloId = (
      await client.destinatario.create({
        data: { ...comuni, numeroAutorizzazione: dati.numeroDocumento ?? `AUT-${n}` },
      })
    ).id
  }
  return { dittaId: ditta.id, sedeId: sedeCreata.id, ruoloId }
}
