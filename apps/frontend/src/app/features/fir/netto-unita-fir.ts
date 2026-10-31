/**
 * Netto della pesa espresso nell'unita' del FIR, mostrato prima della conferma di consegna.
 *
 * Funzione gemella di `nettoNellUnitaFir` in `apps/backend/src/domain/pese/confronto-documento.ts`
 * (alias delle unita' da `domain/waste-movement/unita-misura-registro.ts`): le regole devono
 * restare identiche, perche' il valore scritto nel FIR lo calcola il backend. Kg invariato,
 * tonnellate al centesimo di tonnellata (10 kg, meta' in su); un netto che in tonnellate
 * arrotonda a zero (meno di 5 kg) e unita' non di massa (M3, litri) non si convertono: i
 * messaggi sono quelli del backend.
 */
const ALIAS_KG = ['KG', 'KILOGRAMMI', 'KILOGRAMMO']
const ALIAS_T = ['T', 'TON', 'TONNELLATE', 'TONNELLATA']

/** Peso minimo registrabile nel FIR (colonna Decimal(10,2)). */
export const PESO_FIR_MINIMO = 0.01

export type NettoInUnitaFir = { ok: true; valore: number } | { ok: false; messaggio: string }

type TipoUnita = 'KG' | 'T' | 'ALTRO'

function tipoUnita(unita: string | null | undefined): TipoUnita {
  const u = (unita ?? '').trim().toUpperCase()
  if (u === '' || ALIAS_KG.includes(u)) return 'KG'
  if (ALIAS_T.includes(u)) return 'T'
  return 'ALTRO'
}

/** L'unita' del FIR e' di massa (kg o t): solo allora il netto della pesa si converte. */
export function unitaDiMassa(unita: string | null | undefined): boolean {
  return tipoUnita(unita) !== 'ALTRO'
}

/** Messaggio del backend per un FIR in unita' non di massa. */
export function messaggioUnitaNonConvertibile(unita: string): string {
  return `Il FIR è in ${unita}: il peso della pesa (kg) non si converte.`
}

export function nettoNellUnitaFir(
  nettoKg: number,
  unita: string | null | undefined
): NettoInUnitaFir {
  const tipo = tipoUnita(unita)
  if (tipo === 'ALTRO') {
    return { ok: false, messaggio: messaggioUnitaNonConvertibile(String(unita)) }
  }
  const valore = tipo === 'KG' ? nettoKg : Math.round(nettoKg / 10) / 100
  if (valore < PESO_FIR_MINIMO) {
    return {
      ok: false,
      messaggio: `Il netto è troppo piccolo per essere espresso nel FIR (minimo 0,01 ${unita}): indicare il peso a mano.`,
    }
  }
  return { ok: true, valore }
}
