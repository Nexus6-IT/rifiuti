/** Validazione e normalizzazione, pura, dei dati dell'anagrafica autisti. */
import { giornoValido } from '../../domain/ritiri'
import type { DatiAutista } from './autisti.tipi'

export interface ValoriAutista {
  nome: string
  cognome: string
  codiceFiscale: string | null
  trasportatoreId: string | null
  patenteNumero: string | null
  patenteCategoria: string | null
  patenteScadenza: Date | null
  cqcScadenza: Date | null
  adrScadenza: Date | null
  telefono: string | null
  userId: string | null
}

export type EsitoAutista = { ok: true; valori: ValoriAutista } | { ok: false; messaggi: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODICE_FISCALE = /^[A-Z0-9]{16}$/

const testo = (v: string | null | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

function data(valore: string | null | undefined, nome: string, messaggi: string[]): Date | null {
  const t = testo(valore)
  if (t === null) return null
  if (!giornoValido(t)) {
    messaggi.push(`La scadenza ${nome} non è una data valida.`)
    return null
  }
  return new Date(`${t}T00:00:00.000Z`)
}

export function normalizzaDatiAutista(dati: DatiAutista): EsitoAutista {
  const messaggi: string[] = []

  const nome = (dati.nome ?? '').trim()
  const cognome = (dati.cognome ?? '').trim()
  if (!nome) messaggi.push('Il nome è obbligatorio.')
  if (!cognome) messaggi.push('Il cognome è obbligatorio.')
  if (nome.length > 100) messaggi.push('Il nome può avere al massimo 100 caratteri.')
  if (cognome.length > 100) messaggi.push('Il cognome può avere al massimo 100 caratteri.')

  const cf = testo(dati.codiceFiscale)?.toUpperCase() ?? null
  if (cf !== null && !CODICE_FISCALE.test(cf)) {
    messaggi.push('Il codice fiscale deve avere 16 caratteri.')
  }

  if (dati.trasportatoreId != null && !UUID.test(dati.trasportatoreId)) {
    messaggi.push('Il trasportatore indicato non è valido.')
  }
  if (dati.userId != null && !UUID.test(dati.userId)) {
    messaggi.push('L’utente indicato non è valido.')
  }

  const patenteNumero = testo(dati.patenteNumero)
  if ((patenteNumero?.length ?? 0) > 30) {
    messaggi.push('Il numero della patente può avere al massimo 30 caratteri.')
  }
  const patenteCategoria = testo(dati.patenteCategoria)?.toUpperCase() ?? null
  if ((patenteCategoria?.length ?? 0) > 10) {
    messaggi.push('La categoria della patente può avere al massimo 10 caratteri.')
  }
  const telefono = testo(dati.telefono)
  if ((telefono?.length ?? 0) > 30) messaggi.push('Il telefono può avere al massimo 30 caratteri.')

  const patenteScadenza = data(dati.patenteScadenza, 'della patente', messaggi)
  const cqcScadenza = data(dati.cqcScadenza, 'della CQC', messaggi)
  const adrScadenza = data(dati.adrScadenza, 'dell’ADR', messaggi)

  if (messaggi.length > 0) return { ok: false, messaggi }
  return {
    ok: true,
    valori: {
      nome,
      cognome,
      codiceFiscale: cf,
      trasportatoreId: dati.trasportatoreId ?? null,
      patenteNumero,
      patenteCategoria,
      patenteScadenza,
      cqcScadenza,
      adrScadenza,
      telefono,
      userId: dati.userId ?? null,
    },
  }
}
