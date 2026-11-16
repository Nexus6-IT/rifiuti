import { errore, Esito, ok } from './risultato'

/**
 * `REG1..REG4` + `PROT1..PROT4`: fino a 4 registri di carico/scarico su cui
 * va il movimento e il protocollo (6 cifre) assegnato in ciascuno
 * (`docs/movimenti.md` §2.2). Un registro senza protocollo e' ammesso (il
 * registro puo' non assegnarlo, `REGISTRI RIFIUTI.ASS`); un protocollo senza
 * registro no. Protocollo `0` = non assegnato.
 */
export interface RegistroProtocollo {
  readonly registro: string
  readonly protocollo: number | null
}

export type CodiceRegistri = 'REGISTRO_PROTOCOLLO_INCOERENTE' | 'PROTOCOLLO_NON_NUMERICO'

export function decodificaRegistri(
  reg: readonly (string | null)[],
  prot: readonly (string | null)[]
): Esito<RegistroProtocollo[], CodiceRegistri> {
  const out: RegistroProtocollo[] = []
  const n = Math.max(reg.length, prot.length)
  for (let i = 0; i < n; i++) {
    const r = (reg[i] ?? '').trim()
    const p = (prot[i] ?? '').trim()
    if (r === '') {
      if (p !== '') {
        return errore(
          'REGISTRO_PROTOCOLLO_INCOERENTE',
          `PROT${i + 1} valorizzato senza REG${i + 1}`
        )
      }
      continue
    }
    if (p !== '' && !/^\d{1,6}$/.test(p)) {
      return errore('PROTOCOLLO_NON_NUMERICO', `PROT${i + 1}: attese al piu 6 cifre`)
    }
    const numero = p === '' ? null : Number(p)
    out.push({ registro: r, protocollo: numero === 0 ? null : numero })
  }
  return ok(out)
}
