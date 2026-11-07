/**
 * Valida un file XML FatturaPA contro l'XSD ufficiale (Task 26b, usato dagli e2e della
 * fatturazione, che non importano `apps/backend/src` in Playwright: scansione P45).
 *
 * Uso, DA apps/backend:
 *   npx ts-node -P tsconfig.json scripts/valida-fatturapa.ts <file.xml>
 *
 * Esce con 0 se il file e' valido, con 1 altrimenti (o se il file non si legge). Stampa SOLO i
 * messaggi dell'XSD, che non contengono il contenuto dei campi.
 */
import { readFileSync } from 'fs'
import { validaFatturaPA } from '../src/infrastructure/fatturapa/valida-xsd'

async function main(): Promise<number> {
  const percorso = process.argv[2]
  if (!percorso) {
    console.error('Uso: valida-fatturapa.ts <file.xml>')
    return 1
  }
  let xml: string
  try {
    xml = readFileSync(percorso, 'utf8')
  } catch {
    console.error('File non leggibile.')
    return 1
  }
  const esito = await validaFatturaPA(xml)
  if (esito.valido) return 0
  for (const e of esito.errori) console.error(e)
  return 1
}

main().then(
  codice => process.exit(codice),
  () => {
    console.error('Validazione non riuscita.')
    process.exit(1)
  }
)
