/**
 * Un cambiamento a un ritiro interessa l'autista (e merita un avviso push) solo se riguarda il
 * giro di oggi o di domani: un ritiro fra tre settimane non deve far suonare il telefono.
 * La data di «oggi» e' quella di Roma, perche' il giro dell'app e' per giorno locale.
 */
const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function dataNellaFinestraGiro(dataIso: string, adesso: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return false
  const oggi = FORMATO.format(adesso) // YYYY-MM-DD
  const domani = new Date(`${oggi}T00:00:00.000Z`)
  domani.setUTCDate(domani.getUTCDate() + 1)
  return dataIso === oggi || dataIso === domani.toISOString().slice(0, 10)
}
