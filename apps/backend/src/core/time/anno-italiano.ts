// Tempo italiano: unica sede delle funzioni che dipendono dal calendario di Roma.
// Il processo gira in UTC e NON si imposta TZ globalmente (decisioni 9 e 10): il fuso
// italiano si applica solo qui, dove serve.

/**
 * Anno solare italiano di un istante, usato per il progressivo del registro e per il MUD.
 *
 * Decisione 9: il registro riparte alle 00:00 italiane del 1° gennaio, cioè alle 23:00 UTC
 * del 31 dicembre (in gennaio vige l'ora solare, UTC+1). Aggiungere un'ora e leggere
 * l'anno UTC è esatto per l'unico istante che conta, il cambio d'anno; a metà anno
 * (ora legale) l'anno non cambia comunque.
 */
export function annoSolareItaliano(istante: Date): number {
  return new Date(istante.getTime() + 60 * 60 * 1000).getUTCFullYear()
}

const formatoGiornoRoma = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Giorno di calendario di Roma dell'istante, nel formato 'AAAA-MM-GG'. */
export function giornoItaliano(istante: Date): string {
  return formatoGiornoRoma.format(istante)
}

/** Giorno di calendario di Roma dell'istante, nel formato 'GG/MM/AAAA'. */
export function formattaDataItaliana(istante: Date): string {
  const [anno, mese, giorno] = giornoItaliano(istante).split('-')
  return `${giorno}/${mese}/${anno}`
}

const formatoDataOraRoma = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * Data e ora di Roma dell'istante, nel formato 'GG/MM/AAAA HH:MM'. Ricomposta dalle parti
 * del formatter, così non dipende dalla punteggiatura che la versione di ICU mette tra data e ora.
 */
export function formattaDataOraItaliana(istante: Date): string {
  const parti: Record<string, string> = {}
  for (const parte of formatoDataOraRoma.formatToParts(istante)) parti[parte.type] = parte.value
  return `${parti.day}/${parti.month}/${parti.year} ${parti.hour}:${parti.minute}`
}
