import { expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { inflateRawSync } from 'zlib'
import { getApiUrl } from './env'
import { chiama, codiceCasuale, giornoItaliano, ok, creaListinoLegami } from './legami-api'
import type { Creato, ListinoLegami, Risposta, Versionata } from './legami-api'
import { conPrefissoUnico } from './run-id'
import type { StatoElaborazione } from '../../apps/frontend/src/app/features/fatturazione/fatturazione.model'

/**
 * Supporto API per gli e2e della fatturazione per periodo (4.4b1, Task 26a): periodo, listino con
 * una riga `F`, attese dei job BullMQ e confronto delle chiavi delle risposte con il modello del
 * frontend. Niente di questo file importa `apps/backend/src` (scansione P45); l'unico import dal
 * frontend e` di TIPI di `fatturazione.model.ts`, che non dipende da Angular (Q21).
 */

export type { Creato, ListinoLegami, Risposta, Versionata }
export { chiama, ok, giornoItaliano }

/** Somma `giorni` a una data `AAAA-MM-GG` (aritmetica in UTC: nessun salto d'ora). */
export function spostaGiorni(data: string, giorni: number): string {
  const d = new Date(`${data}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + giorni)
  return d.toISOString().slice(0, 10)
}

/**
 * Periodo della prova (Q26): `[max(1 gennaio dell'anno corrente, oggi - 60), oggi]`. I movimenti
 * sono di oggi e la scadenza della riga `F` e` dieci giorni fa (sempre nel periodo, mai anteriore
 * al 1 gennaio); `fatturazione_da` e` l'inizio del periodo.
 */
export function periodoDiProva(): { dal: string; al: string; scadenzaF: string } {
  const oggi = giornoItaliano()
  const gennaio = `${oggi.slice(0, 4)}-01-01`
  const sessanta = spostaGiorni(oggi, -60)
  const dal = sessanta > gennaio ? sessanta : gennaio
  // Dieci giorni fa, ma non prima dell'inizio del periodo (a inizio anno il periodo e` corto).
  const dieci = spostaGiorni(oggi, -10)
  return { dal, al: oggi, scadenzaF: dieci >= dal ? dieci : dal }
}

export interface PaginaApi<T> {
  elementi: T[]
  totale: number
  pagina: number
  dimensione: number
}

export interface ElaborazioneApi {
  id: string
  stato: StatoElaborazione
  versione: number
  impronta: string | null
  documenti: number
  errori: number
  definitiveAttive: boolean
  erroriGenerali: { codice: string }[]
  errore: { codice: string } | null
  erroreTecnico: string | null
  numerazionePrevista: { registroIvaId: string; codiceRegistro: string; da: string; a: string }[]
}

export interface DocumentoApi {
  id: string
  stato: string
  tipoDocumento: string
  numeroTesto: string | null
  dataDocumento: string
  registro: { id: string; codice: string }
  totaleDocumento: string
  annullabile: boolean
  motivoNonAnnullabile: string | null
  stornabile: boolean
  errori: { codice: string }[]
}

export interface DocumentoDettaglioApi extends DocumentoApi {
  righe: { tipoRiga: string; legameId: string | null; numeroLinea: number }[]
  versione: number
  documentoOrigineId: string | null
  stornoId: string | null
  emessoIl: string | null
  xmlGenerato: boolean
}

export interface ScostamentoApi {
  legameId: string
  versioneLegame: number
  documento: { id: string; numeroTesto: string; dataDocumento: string }
  tipoCorrezione: string
}

export interface NumerazioneApi {
  registroIvaId: string
  anno: number
  ultimoNumero: number
}

/** Le chiavi di un oggetto devono essere esattamente quelle della costante `CHIAVI_*` (Q21). */
export function chiaviUguali(
  etichetta: string,
  reale: Record<string, unknown>,
  attese: Record<string, true>
): void {
  expect(Object.keys(reale).sort(), `chiavi di ${etichetta}`).toEqual(Object.keys(attese).sort())
}

/** Attende (sondando) che un'elaborazione raggiunga uno degli stati; fallisce con lo stato trovato. */
export async function attendiElaborazione(
  token: string,
  id: string,
  stati: StatoElaborazione[],
  timeoutMs = 60_000
): Promise<ElaborazioneApi> {
  const fine = Date.now() + timeoutMs
  let ultima: ElaborazioneApi | undefined
  while (Date.now() < fine) {
    ultima = await ok<ElaborazioneApi>('GET', `/elaborazioni-fatturazione/${id}`, token)
    if (stati.includes(ultima.stato)) return ultima
    if (ultima.stato === 'FALLITA') {
      throw new Error(
        `elaborazione FALLITA: ${ultima.erroreTecnico ?? JSON.stringify(ultima.errore)}`
      )
    }
    await new Promise(r => setTimeout(r, 400))
  }
  throw new Error(
    `elaborazione ${id} non arrivata a ${stati.join('|')} in ${timeoutMs} ms (stato ${ultima?.stato})`
  )
}

/** Avvia l'anteprima (202) e attende `ANTEPRIMA_PRONTA`. */
export async function anteprimaPronta(
  token: string,
  periodo: { dal: string; al: string },
  dataDocumento: string
): Promise<ElaborazioneApi> {
  const avvio = await chiama<{ id: string }>('POST', '/elaborazioni-fatturazione', token, {
    periodoDal: periodo.dal,
    periodoAl: periodo.al,
    dataDocumento,
    raggruppamento: 'PER_CONTRATTO',
    includiArretrati: false,
    filtri: {},
  })
  expect(avvio.stato, `avvio: ${JSON.stringify(avvio.corpo)}`).toBe(202)
  return attendiElaborazione(token, avvio.corpo.id, ['ANTEPRIMA_PRONTA'])
}

export const documentiDi = (token: string, elaborazioneId: string) =>
  ok<PaginaApi<DocumentoApi>>(
    'GET',
    `/elaborazioni-fatturazione/${elaborazioneId}/documenti?pagina=1&dimensione=100`,
    token
  )

export const dettaglioDocumento = (token: string, id: string) =>
  ok<DocumentoDettaglioApi>('GET', `/documenti-fattura/${id}`, token)

/** Chiede la definitiva (202) con impronta e versione dell'anteprima e attende `DEFINITIVA`. */
export async function definitivaCompleta(
  token: string,
  e: ElaborazioneApi
): Promise<ElaborazioneApi> {
  const r = await chiama('POST', `/elaborazioni-fatturazione/${e.id}/definitiva`, token, {
    impronta: e.impronta,
    versione: e.versione,
  })
  expect(r.stato, `definitiva: ${JSON.stringify(r.corpo)}`).toBe(202)
  return attendiElaborazione(token, e.id, ['DEFINITIVA'])
}

/**
 * Aggiunge al listino della prova una riga `F` (canone con scadenza fissa dentro il periodo) e
 * un secondo elenco con la sua riga `CER`, per il cambio di elenco dopo l'annullo (Q1).
 */
export async function aggiungiRigaFEdElencoAlternativo(
  token: string,
  creati: Creato[],
  listino: ListinoLegami,
  scadenzaF: string | null
): Promise<{ elencoAlternativoId: string }> {
  const crea = async (tipo: string, corpo: unknown): Promise<Versionata> => {
    const r = await ok<Versionata>('POST', `/${tipo}`, token, corpo)
    creati.push({ tipo, id: r.id })
    return r
  }
  const rigaCer = await ok<{ codiceIva: { id: string } | null }>(
    'GET',
    `/righe-addebito/${listino.rigaCerA.id}`,
    token
  )
  const codiceIvaId = rigaCer.codiceIva!.id
  const gruppo = await crea('codifiche-addebito', {
    genere: 'GRUPPO',
    descrizione: conPrefissoUnico('Gruppo F'),
  })
  const addebitoF = await crea('addebiti', {
    descrizione: conPrefissoUnico('Canone F'),
    gruppoId: gruppo.id,
    unitaMisura: 'NR',
    codiceIvaId,
    tipo: 'F',
    listini: [{ numero: 2, prezzo: '3.00' }],
  })
  if (scadenzaF !== null) {
    const [anno, mese, giorno] = scadenzaF.split('-').map(Number)
    await ok('POST', `/elenchi-addebiti/${listino.elencoId}/righe`, token, {
      tipo: 'F',
      addebitoId: addebitoF.id,
      unitaMisura: 'NR',
      codiceIvaId,
      prezzo: '3.00',
      quantitaFissa: '1',
      scadenze: [{ ordine: 1, giorno, mese, anno }],
    })
  }
  // Elenco alternativo (non predefinito) con una riga CER propria, per cambiare elenco al legame.
  const alt = await ok<Versionata>(
    'POST',
    `/contratti-clienti/${listino.contrattoId}/elenchi`,
    token,
    {
      descrizione: `Alternativo ${codiceCasuale(6)}`,
      predefinito: false,
    }
  )
  await ok('POST', `/elenchi-addebiti/${alt.id}/righe`, token, {
    tipo: 'CER',
    cerCode: '15 01 01',
    tipoQuantita: 'PESO_NETTO',
    unitaMisura: 'KG',
    codiceIvaId,
    prezzo: '9.00',
  })
  return { elencoAlternativoId: alt.id }
}

export { codiceCasuale, creaListinoLegami }

// ---------------------------------------------------------------------------------------------
// 4.4b2 (Task 26b): download binari, lettura di uno ZIP e validazione con lo script del backend.
// ---------------------------------------------------------------------------------------------

export interface Scaricato {
  stato: number
  tipo: string
  intestazioni: Headers
  corpo: Buffer
}

/** Chiamata che restituisce i byte della risposta (XML, ZIP): il client `chiama` legge solo testo. */
export async function scarica(
  metodo: string,
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<Scaricato> {
  for (let tentativo = 1; ; tentativo++) {
    const r = await fetch(`${getApiUrl()}${percorso}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    if (r.status === 429 && tentativo < 6) {
      await new Promise(res => setTimeout(res, 2000 * tentativo))
      continue
    }
    return {
      stato: r.status,
      tipo: r.headers.get('content-type') ?? '',
      intestazioni: r.headers,
      corpo: Buffer.from(await r.arrayBuffer()),
    }
  }
}

/** Contenuto di un file ZIP (metodi 0 e 8) letto dalla directory centrale: nessuna dipendenza. */
export function leggiZip(zip: Buffer): Map<string, Buffer> {
  const risultato = new Map<string, Buffer>()
  let fine = -1
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fine = i
      break
    }
  }
  if (fine < 0) throw new Error('ZIP non valido: directory centrale assente')
  const voci = zip.readUInt16LE(fine + 10)
  let p = zip.readUInt32LE(fine + 16)
  for (let n = 0; n < voci; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP non valido: voce illeggibile')
    const metodo = zip.readUInt16LE(p + 10)
    const dimCompressa = zip.readUInt32LE(p + 20)
    const lunNome = zip.readUInt16LE(p + 28)
    const lunExtra = zip.readUInt16LE(p + 30)
    const lunCommento = zip.readUInt16LE(p + 32)
    const offset = zip.readUInt32LE(p + 42)
    const nome = zip.subarray(p + 46, p + 46 + lunNome).toString('utf8')
    const lunNomeLocale = zip.readUInt16LE(offset + 26)
    const lunExtraLocale = zip.readUInt16LE(offset + 28)
    const inizio = offset + 30 + lunNomeLocale + lunExtraLocale
    const dati = zip.subarray(inizio, inizio + dimCompressa)
    risultato.set(nome, metodo === 0 ? Buffer.from(dati) : inflateRawSync(dati))
    p += 46 + lunNome + lunExtra + lunCommento
  }
  return risultato
}

/**
 * Valida un XML FatturaPA con `apps/backend/scripts/valida-fatturapa.ts` (XSD ufficiale), lanciato
 * da `apps/backend` (scansione P45: l'e2e non importa il codice del backend). Il file temporaneo
 * si rimuove sempre.
 */
export function validaConScript(xml: Buffer | string): { valido: boolean; messaggi: string } {
  const dir = mkdtempSync(join(tmpdir(), 'valida-fatturapa-'))
  try {
    const file = join(dir, 'fattura.xml')
    writeFileSync(file, xml)
    try {
      execFileSync('npx', ['ts-node', '-P', 'tsconfig.json', 'scripts/valida-fatturapa.ts', file], {
        cwd: resolve(__dirname, '../../apps/backend'),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      })
      return { valido: true, messaggi: '' }
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer }
      return { valido: false, messaggi: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
