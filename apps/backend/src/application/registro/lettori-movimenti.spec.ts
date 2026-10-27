import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

const SRC = join(__dirname, '..', '..')

/**
 * Guardia statica sui lettori di `waste_movements` (Fase 2 pezzo 3, R3).
 *
 * Con le rettifiche e gli annullamenti il registro contiene anche righe che non sono piu' il
 * dato vigente: chi calcola giacenze, MUD o anomalie deve contare solo le vigenti
 * (`domain/waste-movement/vigenza.ts`). Ogni file non spec che legge `waste_movements` (Prisma
 * `wasteMovement.` o SQL grezzo) deve stare in questo elenco con la scelta fatta:
 *  - 'vigenti': conta solo le vigenti, quindi deve importare `vigenza`;
 *  - 'ordinarie': guarda solo le registrazioni `ORDINARIA` (la ricopia del FIR), quindi deve
 *    filtrare `tipoAnnotazione: 'ORDINARIA'`;
 *  - 'tutte': legge ogni riga di proposito (numerazione, "esiste almeno un movimento", elenco).
 * Un file nuovo che legge i movimenti fa fallire il test finche' qualcuno non sceglie.
 *
 * Limiti noti: il controllo "vigenti" verifica solo che il file importi `vigenza`, non che ogni
 * singola query di un file gia in elenco lo usi; `senzaCommenti` non gestisce gli apici dentro
 * una regex literal (potrebbe scambiarli per l'inizio di una stringa).
 */
type Scelta = 'vigenti' | 'ordinarie' | 'tutte'

const LETTORI: Record<string, { scelta: Scelta; motivo: string }> = {
  'application/anomaly/anomaly-detection.service.ts': {
    scelta: 'vigenti',
    motivo: 'giacenze impossibili: le catene annullate non contano',
  },
  'application/giacenze/giacenze.service.ts': {
    scelta: 'vigenti',
    motivo: 'giacenze, carico piu vecchio e scarichi dei FIR annullati',
  },
  'application/mud/aggregazione/mud-aggregazione.service.ts': {
    scelta: 'vigenti',
    motivo: "movimenti dell'anno, anni precedenti, scarichi dei FIR, saldi al 31 dicembre",
  },
  'application/registro/giacenza-disponibile.ts': {
    scelta: 'vigenti',
    motivo: 'saldi del registro e unita non di massa',
  },
  'application/registro/giacenze-iniziali.service.ts': {
    scelta: 'vigenti',
    motivo:
      "avviso G8 solo sulle vigenti; elenco e controllaNonUsata leggono invece tutte le righe (una correzione SCARICO dopo l'apertura la rende usata)",
  },
  'application/registro/use-cases/registra-movimento.use-case.ts': {
    scelta: 'ordinarie',
    motivo:
      'ricopia del FIR e messaggio del doppio solo sulle ORDINARIE; la numerazione (MAX) legge tutte le righe',
  },
  'application/registro/numerazione-annotazione.ts': {
    scelta: 'tutte',
    motivo: 'numerazione (MAX) e hash precedente: ogni riga del registro, vigente o no',
  },
  'application/registro/use-cases/correggi-movimento.use-case.ts': {
    scelta: 'tutte',
    motivo: "legge l'annotazione da correggere, le sue correzioni e la radice della catena",
  },
  'application/registro/progressivo-iniziale.service.ts': {
    scelta: 'tutte',
    motivo: 'haMovimenti: qualunque riga, correzioni comprese, blocca il progressivo iniziale',
  },
  'application/registro/queries/list-movimenti.handler.ts': {
    scelta: 'tutte',
    motivo: 'elenco del registro: mostra ogni riga con il suo stato',
  },
  'application/registro/verifica-catena-registro.service.ts': {
    scelta: 'tutte',
    motivo: 'la catena degli hash comprende ogni riga, vigente o no',
  },
  'infrastructure/rentri/rentri-unita-locale.service.ts': {
    scelta: 'tutte',
    motivo: 'una sede con qualunque riga nel registro non si elimina',
  },
}

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap(nome => {
    const percorso = join(dir, nome)
    if (statSync(percorso).isDirectory()) return sorgenti(percorso)
    return nome.endsWith('.ts') && !nome.endsWith('.spec.ts') ? [percorso] : []
  })
}

/** Toglie i commenti rispettando le stringhe e i template. */
function senzaCommenti(testo: string): string {
  let fuori = ''
  let i = 0
  while (i < testo.length) {
    const c = testo[i]
    const n = testo[i + 1]
    if (c === '/' && n === '/') {
      while (i < testo.length && testo[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const fine = testo.indexOf('*/', i + 2)
      i = fine === -1 ? testo.length : fine + 2
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < testo.length && testo[j] !== c) j += testo[j] === '\\' ? 2 : 1
      fuori += testo.slice(i, j + 1)
      i = j + 1
    } else {
      fuori += c
      i++
    }
  }
  return fuori
}

/** Lettura dei movimenti: client Prisma, relazioni inverse o SQL grezzo. */
const LEGGE_MOVIMENTI =
  /\bwasteMovement\.|\bwaste_movements\b|\b(wasteMovements|recordedMovements)\b|\bmovimenti\s*:\s*(true|\{)/

function leggeMovimenti(testo: string): boolean {
  return LEGGE_MOVIMENTI.test(senzaCommenti(testo))
}

/** Problemi di un sorgente rispetto alla scelta dichiarata; vuoto se e' in regola. */
function problemi(testo: string, scelta: Scelta): string[] {
  const codice = senzaCommenti(testo)
  const out: string[] = []
  if (scelta === 'vigenti' && !/domain\/waste-movement\/vigenza/.test(codice)) {
    out.push('dichiara "vigenti" ma non importa vigenza')
  }
  if (scelta === 'ordinarie' && !/tipoAnnotazione:\s*'ORDINARIA'/.test(codice)) {
    out.push('dichiara "ordinarie" ma non filtra tipoAnnotazione ORDINARIA')
  }
  return out
}

function lettori(): string[] {
  return sorgenti(SRC)
    .map(f => relative(SRC, f).split(sep).join('/'))
    .filter(rel => leggeMovimenti(readFileSync(join(SRC, rel), 'utf8')))
    .sort()
}

describe('lettori dei movimenti', () => {
  it("i file che leggono waste_movements sono esattamente quelli dell'elenco", () => {
    const trovati = lettori().filter(f => f !== 'domain/waste-movement/vigenza.ts')
    const elencati = Object.keys(LETTORI).sort()
    const nuovi = trovati.filter(f => !elencati.includes(f))
    const obsoleti = elencati.filter(f => !trovati.includes(f))
    expect({ nuovi, obsoleti }).toEqual({ nuovi: [], obsoleti: [] })
  })

  it('ogni voce ha un motivo', () => {
    for (const [file, { motivo }] of Object.entries(LETTORI)) {
      expect({ file, ok: motivo.trim().length > 10 }).toEqual({ file, ok: true })
    }
  })

  it('ogni lettore rispetta la scelta dichiarata', () => {
    const risultato: Record<string, string[]> = {}
    for (const [file, { scelta }] of Object.entries(LETTORI)) {
      const p = problemi(readFileSync(join(SRC, file), 'utf8'), scelta)
      if (p.length > 0) risultato[file] = p
    }
    expect(risultato).toEqual({})
  })

  describe('la guardia funziona (sorgenti finti)', () => {
    it('riconosce Prisma, SQL grezzo e le relazioni inverse', () => {
      expect(leggeMovimenti('await this.prisma.wasteMovement.findMany({})')).toBe(true)
      expect(leggeMovimenti('tx.$queryRaw`SELECT 1 FROM waste_movements`')).toBe(true)
      expect(leggeMovimenti('tenant.wasteMovements')).toBe(true)
      expect(
        leggeMovimenti('prisma.registroRifiuti.findMany({ include: { movimenti: true } })')
      ).toBe(true)
      expect(
        leggeMovimenti('registro.findMany({ select: { movimenti: { select: { id: true } } } })')
      ).toBe(true)
      // un campo "movimenti" di un oggetto qualunque (array, non relazione) non e' una lettura
      expect(leggeMovimenti('const out = { movimenti: [1, 2] }')).toBe(false)
    })

    it('ignora i commenti', () => {
      expect(leggeMovimenti('// legge wasteMovement.findMany\n/* waste_movements */')).toBe(false)
    })

    it('un lettore "vigenti" senza vigenza fallisce, con vigenza passa', () => {
      const senza = 'const x = await prisma.wasteMovement.findMany({ where: { tenantId } })'
      const con = `import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'\n${senza}`
      expect(problemi(senza, 'vigenti')).toHaveLength(1)
      expect(problemi(con, 'vigenti')).toEqual([])
    })

    it('un lettore "ordinarie" senza filtro fallisce, con filtro passa', () => {
      const senza = 'prisma.wasteMovement.findMany({ where: { firId } })'
      const con =
        "prisma.wasteMovement.findMany({ where: { firId, tipoAnnotazione: 'ORDINARIA' } })"
      expect(problemi(senza, 'ordinarie')).toHaveLength(1)
      expect(problemi(con, 'ordinarie')).toEqual([])
    })

    it('un lettore "tutte" non ha requisiti', () => {
      expect(problemi('prisma.wasteMovement.count()', 'tutte')).toEqual([])
    })
  })
})
