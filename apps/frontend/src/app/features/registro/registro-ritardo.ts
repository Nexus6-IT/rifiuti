/**
 * Ritardo della registrazione mostrato nel form, contato come il backend
 * (`giorniItalianiFra` in waste-movement.entity.ts): giorni di calendario fra il
 * giorno dell'operazione e il giorno italiano (Europe/Rome) della registrazione,
 * mai la differenza fra istanti divisa per 24 ore.
 */

const formatoGiornoRoma = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Giorno di calendario locale 'AAAA-MM-GG': è la data dell'operazione inviata al backend. */
function giornoLocale(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const mezzanotteUtc = (giorno: string): number => Date.parse(`${giorno}T00:00:00Z`)

/** Giorni di ritardo fra l'operazione e una registrazione fatta `adesso` (mai negativi). */
export function giorniDiRitardo(operazione: Date, adesso: Date = new Date()): number {
  const giorni =
    (mezzanotteUtc(formatoGiornoRoma.format(adesso)) - mezzanotteUtc(giornoLocale(operazione))) /
    86_400_000
  return Math.max(0, Math.round(giorni))
}
