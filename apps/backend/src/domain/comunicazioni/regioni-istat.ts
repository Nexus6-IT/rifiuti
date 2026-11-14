/**
 * Regioni italiane: nome (come in `istat_province.regione`), codice ISTAT a 2 cifre e lettera di
 * WinWaste (`PROVINCE.REG`, usata nei tracciati CONOU e COBAT).
 */
interface Regione {
  readonly nome: string
  readonly codice: string
  readonly lettera: string
}

// INFERENZA (WinWaste, 14/11): le lettere vengono dalla mappa `calcolaIstatRegioni` di WinWaste
// (`A01 B02 C07 D03 E04 F05 G06 I08 L11 M09 N10 O12 P15 Q13 R14 S16 T17 U18 V19 Z20`).
export const REGIONI: readonly Regione[] = [
  { nome: 'Piemonte', codice: '01', lettera: 'A' },
  { nome: "Valle d'Aosta/Vallée d'Aoste", codice: '02', lettera: 'B' },
  { nome: 'Liguria', codice: '07', lettera: 'C' },
  { nome: 'Lombardia', codice: '03', lettera: 'D' },
  { nome: 'Trentino-Alto Adige/Südtirol', codice: '04', lettera: 'E' },
  { nome: 'Veneto', codice: '05', lettera: 'F' },
  { nome: 'Friuli-Venezia Giulia', codice: '06', lettera: 'G' },
  { nome: 'Emilia-Romagna', codice: '08', lettera: 'I' },
  { nome: 'Marche', codice: '11', lettera: 'L' },
  { nome: 'Toscana', codice: '09', lettera: 'M' },
  { nome: 'Umbria', codice: '10', lettera: 'N' },
  { nome: 'Lazio', codice: '12', lettera: 'O' },
  { nome: 'Campania', codice: '15', lettera: 'P' },
  { nome: 'Abruzzo', codice: '13', lettera: 'Q' },
  { nome: 'Molise', codice: '14', lettera: 'R' },
  { nome: 'Puglia', codice: '16', lettera: 'S' },
  { nome: 'Basilicata', codice: '17', lettera: 'T' },
  { nome: 'Calabria', codice: '18', lettera: 'U' },
  { nome: 'Sicilia', codice: '19', lettera: 'V' },
  { nome: 'Sardegna', codice: '20', lettera: 'Z' },
]

/** Lettera di WinWaste per codice regione ISTAT a 2 cifre. */
export const REGIONE_LETTERA: Readonly<Record<string, string>> = Object.fromEntries(
  REGIONI.map(r => [r.codice, r.lettera])
)

function chiave(nome: string): string {
  return nome.normalize('NFC').trim().toLowerCase().replace(/’/g, "'")
}

function perNome(nome: string): Regione | undefined {
  const k = chiave(nome)
  return REGIONI.find(r => chiave(r.nome) === k)
}

/** Codice ISTAT `01..20` dal nome della regione, o `null` se sconosciuta. */
export function codiceRegione(nome: string): string | null {
  return perNome(nome)?.codice ?? null
}

/** Lettera di WinWaste dal nome della regione, o `null` se sconosciuta. */
export function letteraRegione(nome: string): string | null {
  return perNome(nome)?.lettera ?? null
}

/**
 * Codice ISTAT a 9 cifre del CONOU: `0` + regione (2) + comune (6).
 * Lancia se la regione è sconosciuta o il comune non ha 6 cifre.
 */
export function istatNoveConou(regione: string, comune6: string): string {
  const cod = codiceRegione(regione)
  if (!cod) throw new RangeError(`Regione sconosciuta: ${JSON.stringify(regione)}`)
  if (!/^\d{6}$/.test(comune6))
    throw new RangeError(`Codice ISTAT del comune non valido: ${JSON.stringify(comune6)}`)
  return `0${cod}${comune6}`
}
