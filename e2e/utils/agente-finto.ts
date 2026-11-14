/**
 * Agente di pesa FINTO per gli e2e (4.8b): fa in Node quello che fa `tools/agente-pesa` sul PC della
 * pesa, senza il programma Go. Genera la coppia Ed25519, si abbina col codice letto dalla pagina,
 * manda il battito e invia letture firmate (SIMULATA) nel formato del contratto
 * `wasteflow-lettura-pesa-v1` (firma su `prefisso + byte del payload`, vedi
 * `apps/backend/src/domain/pese/agenti/payload-lettura.ts`).
 *
 * Usa `fetch` e `crypto` di Node: nessuna dipendenza nuova, nessun accesso al database.
 */
import { generateKeyPairSync, randomUUID, sign } from 'crypto'
import type { KeyObject } from 'crypto'
import { getApiUrl } from './env'

const PREFISSO_FIRMA = 'wasteflow-lettura-pesa-v1\n'

export interface EsitoLettura {
  chiaveIdempotenza: string
  esito: string
  codice?: string
}

export interface RispostaHttp<T = unknown> {
  stato: number
  corpo: T
}

/** Offset ISO 8601 con `Z`: il backend richiede data, ora e offset. */
const adesso = (): string => new Date().toISOString()

export class AgenteFinto {
  private sequenza = 0

  private constructor(
    readonly agenteId: string,
    private readonly token: string,
    private readonly privata: KeyObject,
    readonly strumentoIds: string[]
  ) {}

  /** Genera le chiavi e scambia il codice di abbinamento col token dell'agente. */
  static async abbina(codice: string, nomeHost = 'pc-pesa-e2e'): Promise<AgenteFinto> {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const der = publicKey.export({ format: 'der', type: 'spki' })
    const chiavePubblica = der.subarray(der.length - 32).toString('base64')
    const r = await fetch(`${getApiUrl()}/agenti-pesa/abbinamento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codice, chiavePubblica, nomeHost, versione: 'e2e-0.0.0' }),
    })
    const corpo = (await r.json().catch(() => ({}))) as {
      agenteId?: string
      token?: string
      strumenti?: { id: string }[]
    }
    if (r.status !== 200 && r.status !== 201) {
      throw new Error(`abbinamento rifiutato (${r.status}): ${JSON.stringify(corpo)}`)
    }
    if (!corpo.agenteId || !corpo.token) throw new Error('risposta di abbinamento senza token')
    return new AgenteFinto(
      corpo.agenteId,
      corpo.token,
      privateKey,
      (corpo.strumenti ?? []).map(s => s.id)
    )
  }

  private async chiama<T>(percorso: string, metodo: 'GET' | 'POST', corpo?: unknown) {
    const r = await fetch(`${getApiUrl()}/agenti-pesa/${percorso}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
    const testo = await r.text()
    let letto: unknown = testo
    try {
      letto = testo ? JSON.parse(testo) : null
    } catch {
      /* corpo non JSON: resta il testo */
    }
    return { stato: r.status, corpo: letto as T } satisfies RispostaHttp<T>
  }

  /** Strumenti assegnati all'agente (si aggiorna dopo che l'amministratore li assegna). */
  async configurazione(): Promise<RispostaHttp<{ strumenti: { id: string }[] }>> {
    return this.chiama('configurazione', 'GET')
  }

  /** Battito: e' cio' che fa risultare l'agente «In linea» nella pagina. */
  async battito(
    strumenti: { strumentoId: string; stato: 'OK' | 'ERRORE' | 'NON_CONFIGURATO' }[] = []
  ): Promise<RispostaHttp> {
    return this.chiama('battito', 'POST', {
      versione: 'e2e-0.0.0',
      oraAgente: adesso(),
      codaInAttesa: 0,
      lettureScartate: 0,
      ultimaSequenza: this.sequenza,
      strumenti,
    })
  }

  /** Costruisce e firma una lettura SIMULATA stabile. `pesoKg` con il punto e due decimali. */
  private lettura(strumentoId: string, pesoKg: string): { payload: string; firma: string } {
    this.sequenza += 1
    const ora = adesso()
    const payload = {
      v: 1,
      agenteId: this.agenteId,
      strumentoId,
      chiaveIdempotenza: randomUUID(),
      sequenza: this.sequenza,
      pesoKg,
      unita: 'kg',
      stabile: true,
      alibiId: `SIM-${String(this.sequenza).padStart(6, '0')}`,
      oraStrumento: ora,
      oraAgente: ora,
      driver: 'SIMULATA',
      simulata: true,
      grezzo: null,
    }
    const byte = Buffer.from(JSON.stringify(payload), 'utf8')
    const firma = sign(
      null,
      Buffer.concat([Buffer.from(PREFISSO_FIRMA, 'utf8'), byte]),
      this.privata
    )
    return { payload: byte.toString('base64'), firma: firma.toString('base64') }
  }

  /** Invia un lotto di letture (una per peso) e restituisce la risposta grezza del server. */
  async inviaLetture(
    strumentoId: string,
    pesiKg: string[]
  ): Promise<RispostaHttp<{ esiti: EsitoLettura[] }>> {
    return this.chiama('letture', 'POST', {
      letture: pesiKg.map(p => this.lettura(strumentoId, p)),
    })
  }
}
