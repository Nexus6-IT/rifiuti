import { randomBytes, randomUUID } from 'crypto'
import { identificativoRegistroValido } from '../dominio/identificativo-registro'

/**
 * Registro cronologico aperto su RENTRI per una unita' locale (`RegistroModel`
 * di `anagrafiche.yaml`, ridotto ai campi che la fake serve).
 */
export interface RegistroOperatore {
  identificativo: string
  descrizione: string | null
  numIscrSito: string
  attivita: string[]
  attivitaRecSmalt: string[]
  dataCreazione: string
  dataModifica: string | null
  dataChiusura: string | null
  /** Identificativo della richiesta di vidimazione (compare nell'eREGI). */
  identificativoRichiesta: string
}

export type OperazioneRegistro = 'apri' | 'modifica' | 'chiudi'

/**
 * Esito che il canale di controllo puo' forzare DOPO che l'operazione e' stata
 * eseguita: lo stato cambia ma il chiamante non riceve la risposta giusta. E'
 * il caso che rende non idempotente la POST di apertura (5xx o timeout senza
 * sapere se il registro esiste).
 */
export interface EsitoPersoConfigurato {
  tipo: '5xx' | 'timeout'
  /** Solo per `5xx`: codice di stato da restituire (500-599). */
  stato: number
  volte: number
}

const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Stato in memoria dei registri aperti tramite l'API `anagrafiche` (azzerato da `__controllo/azzera`). */
export class RegistriOperatore {
  private registri = new Map<string, RegistroOperatore>()
  private esitiPersi = new Map<OperazioneRegistro, EsitoPersoConfigurato>()

  azzera(): void {
    this.registri.clear()
    this.esitiPersi.clear()
  }

  /** Identificativo `R` + 10 caratteri `[0-9A-Z]` (pattern del contratto), mai gia' in uso. */
  private nuovoIdentificativo(): string {
    for (;;) {
      const byte = randomBytes(10)
      const candidato = `R${Array.from(byte, b => ALFABETO[b % ALFABETO.length]).join('')}`
      if (!this.registri.has(candidato) && identificativoRegistroValido(candidato)) return candidato
    }
  }

  apri(dati: {
    numIscrSito: string
    attivita: string[]
    attivitaRecSmalt?: string[] | null
    descrizione?: string | null
    identificativo?: string
    chiuso?: boolean
  }): RegistroOperatore {
    const adesso = new Date().toISOString()
    const registro: RegistroOperatore = {
      identificativo: dati.identificativo ?? this.nuovoIdentificativo(),
      descrizione: dati.descrizione ?? null,
      numIscrSito: dati.numIscrSito,
      attivita: [...dati.attivita],
      attivitaRecSmalt: [...(dati.attivitaRecSmalt ?? [])],
      dataCreazione: adesso,
      dataModifica: null,
      dataChiusura: dati.chiuso ? adesso : null,
      identificativoRichiesta: randomUUID(),
    }
    this.registri.set(registro.identificativo, registro)
    return registro
  }

  trova(identificativo: string): RegistroOperatore | undefined {
    return this.registri.get(identificativo)
  }

  elencaPerSito(numIscrSito: string): RegistroOperatore[] {
    return [...this.registri.values()]
      .filter(r => r.numIscrSito === numIscrSito)
      .sort((a, b) => a.dataCreazione.localeCompare(b.dataCreazione))
  }

  modifica(
    registro: RegistroOperatore,
    cambi: { descrizione?: string | null; attivitaRecSmalt?: string[] | null }
  ): void {
    if (cambi.descrizione !== undefined && cambi.descrizione !== null) {
      registro.descrizione = cambi.descrizione
    }
    if (cambi.attivitaRecSmalt !== undefined && cambi.attivitaRecSmalt !== null) {
      registro.attivitaRecSmalt = [...cambi.attivitaRecSmalt]
    }
    registro.dataModifica = new Date().toISOString()
  }

  chiudi(registro: RegistroOperatore): void {
    registro.dataChiusura = new Date().toISOString()
  }

  // --- Esiti persi (canale di controllo) -----------------------------------

  impostaEsitoPerso(operazione: OperazioneRegistro, esito: EsitoPersoConfigurato | null): void {
    if (esito === null) this.esitiPersi.delete(operazione)
    else this.esitiPersi.set(operazione, { ...esito })
  }

  /** Consuma un'occorrenza dell'esito perso previsto per l'operazione, se c'e' ancora. */
  consumaEsitoPerso(operazione: OperazioneRegistro): EsitoPersoConfigurato | null {
    const esito = this.esitiPersi.get(operazione)
    if (!esito || esito.volte <= 0) return null
    esito.volte -= 1
    return { ...esito }
  }
}
