import * as fs from 'fs'
import * as path from 'path'
import * as Sentry from '@sentry/node'
import { segnalaErroreJob } from './segnala-errore-job'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

const SRC_BACKEND = path.resolve(__dirname, '../..')

/** file#metodo → motivo per cui un @Cron può non segnalare a Bugsink. Oggi nessuno. */
const CRON_SENZA_SEGNALAZIONE: Record<string, string> = {}

/**
 * Dall'indice di `@Cron(` trova il nome e il corpo del metodo decorato.
 * Conta le tonde fino a quella che chiude la chiamata (saltando stringhe e template literal,
 * così le graffe di un oggetto di opzioni non contano), salta altri decoratori, legge il nome,
 * salta i parametri e prende il blocco `{ … }`.
 */
function corpoMetodoDopoCron(
  sorgente: string,
  indiceCron: number
): { nome: string; corpo: string } {
  // `da` punta a `apri`; ritorna l'indice subito dopo la chiusura corrispondente
  const salta = (da: number, apri: string, chiudi: string): number => {
    let profondita = 0
    let i = da
    while (i < sorgente.length) {
      const c = sorgente[i]
      if (c === "'" || c === '"' || c === '`') {
        i++
        while (i < sorgente.length && sorgente[i] !== c) {
          if (sorgente[i] === '\\') i++
          i++
        }
      } else if (c === '/' && sorgente[i + 1] === '/') {
        while (i < sorgente.length && sorgente[i] !== '\n') i++
      } else if (c === '/' && sorgente[i + 1] === '*') {
        i = sorgente.indexOf('*/', i + 2) + 1
      } else if (c === apri) {
        profondita++
      } else if (c === chiudi) {
        profondita--
        if (profondita === 0) return i + 1
      }
      i++
    }
    throw new Error('parentesi non chiusa')
  }

  let pos = salta(sorgente.indexOf('(', indiceCron), '(', ')')
  // altri decoratori: @Nome(...) oppure @Nome
  for (;;) {
    const resto = /^\s*@[A-Za-z_$][\w$]*/.exec(sorgente.slice(pos))
    if (!resto) break
    pos += resto[0].length
    if (sorgente[pos] === '(') pos = salta(pos, '(', ')')
  }
  const m = /(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(sorgente.slice(pos))
  if (!m) throw new Error('nome del metodo non trovato')
  const nome = m[1]
  const aperta = pos + m.index + m[0].length - 1
  const dopoParametri = salta(aperta, '(', ')')
  const inizioCorpo = sorgente.indexOf('{', dopoParametri)
  const fineCorpo = salta(inizioCorpo, '{', '}')
  return { nome, corpo: sorgente.slice(inizioCorpo, fineCorpo) }
}

function fileTsProduzione(dir: string): string[] {
  const out: string[] = []
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const percorso = path.join(dir, voce.name)
    if (voce.isDirectory()) out.push(...fileTsProduzione(percorso))
    else if (voce.name.endsWith('.ts') && !voce.name.endsWith('.spec.ts')) out.push(percorso)
  }
  return out
}

describe('segnalaErroreJob', () => {
  beforeEach(() => jest.clearAllMocks())

  it('invia l errore con il tag del job', () => {
    segnalaErroreJob('checkMudDeadlines', new Error('db giù'))
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'checkMudDeadlines' },
    })
  })

  it('accetta anche un valore che non è un Error e non lancia se Sentry lancia', () => {
    ;(Sentry.captureException as jest.Mock).mockImplementationOnce(() => {
      throw new Error('rete')
    })
    expect(() => segnalaErroreJob('x', 'stringa')).not.toThrow()
  })

  it('aggiunge i tag passati, come il tenant', () => {
    segnalaErroreJob('eseguiRiconciliazione', new Error('401'), { tenantId: 't2' })
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'eseguiRiconciliazione', tenantId: 't2' },
    })
  })

  it('il guardiano trova il corpo del metodo anche con un @Cron con opzioni', () => {
    const sorgente =
      "class X {\n  @Cron('0 3 * * *', { name: 'x', timeZone: 'UTC' })\n  async lavora(a: string): Promise<void> {\n    if (a) { segnalaErroreJob('lavora', a) }\n  }\n}"
    const r = corpoMetodoDopoCron(sorgente, sorgente.indexOf('@Cron('))
    expect(r.nome).toBe('lavora')
    expect(r.corpo).toContain("segnalaErroreJob('lavora', a)")
    expect(r.corpo).not.toContain('timeZone')
  })

  it('ogni metodo @Cron dei sorgenti chiama segnalaErroreJob', () => {
    // Limite noto: il guardiano è testuale e non vede gli errori che un catch interno
    // inghiotte (safe() è coperto a mano, i catch per utente di checkMudDeadlines restano nel log).
    const mancanti: string[] = []
    let trovati = 0
    for (const file of fileTsProduzione(SRC_BACKEND)) {
      const sorgente = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      let indice = sorgente.indexOf('@Cron(')
      while (indice !== -1) {
        trovati++
        const { nome, corpo } = corpoMetodoDopoCron(sorgente, indice)
        const chiave = `${path.relative(SRC_BACKEND, file).replace(/\\/g, '/')}#${nome}`
        if (!corpo.includes('segnalaErroreJob(') && !(chiave in CRON_SENZA_SEGNALAZIONE)) {
          mancanti.push(chiave)
        }
        indice = sorgente.indexOf('@Cron(', indice + 1)
      }
    }
    expect(mancanti).toEqual([])
    expect(trovati).toBeGreaterThanOrEqual(11)
  })
})
