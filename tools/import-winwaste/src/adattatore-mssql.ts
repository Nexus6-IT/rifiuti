import * as sql from 'mssql'
import {
  ColonnaSql,
  SorgenteSql,
} from '../../../apps/backend/src/application/migrazione/estrazione/estrai-staging'

/**
 * Adattatore `mssql` della `SorgenteSql` del nucleo di estrazione. E' l'unico
 * punto del progetto che conosce il driver SQL Server.
 */
export interface ConfigurazioneSorgente {
  readonly server: string
  readonly porta: number
  readonly database: string
  readonly utente: string
  readonly password: string
  /** Accetta il certificato del server (container di prova con certificato autofirmato). */
  readonly fidatiDelCertificato?: boolean
}

export interface SorgenteMssql extends SorgenteSql {
  chiudi(): Promise<void>
}

const CODA_MASSIMA = 1000

export async function apriSorgente(cfg: ConfigurazioneSorgente): Promise<SorgenteMssql> {
  const pool = new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.porta,
    database: cfg.database,
    user: cfg.utente,
    password: cfg.password,
    // L'estrazione di una tabella grande dura piu' dei 15 s di default.
    requestTimeout: 0,
    options: { encrypt: true, trustServerCertificate: cfg.fidatiDelCertificato === true },
  })
  await pool.connect()

  const quota = (n: string): string => `[${n.replace(/]/g, ']]')}]`

  return {
    database: cfg.database,

    async permessiEffettivi(): Promise<string[]> {
      // Permessi effettivi sul database, sul server e sulla tabella piu' importante, piu' i
      // ruoli fissi che li danno (db_owner, db_datawriter, sysadmin).
      const r = await pool.request().query<{ permesso: string | null }>(`
        SELECT permission_name AS permesso FROM fn_my_permissions(NULL, 'DATABASE')
        UNION SELECT permission_name FROM fn_my_permissions(NULL, 'SERVER')
        UNION SELECT permission_name FROM fn_my_permissions(N'dbo.MOVIMENTI', 'OBJECT')
        UNION SELECT CASE WHEN IS_SRVROLEMEMBER('sysadmin') = 1 THEN 'CONTROL SERVER' END
        UNION SELECT CASE WHEN IS_MEMBER('db_owner') = 1 THEN 'CONTROL' END
        UNION SELECT CASE WHEN IS_MEMBER('db_datawriter') = 1 THEN 'INSERT' END
        UNION SELECT CASE WHEN IS_MEMBER('db_ddladmin') = 1 THEN 'ALTER' END`)
      return r.recordset.map((x) => x.permesso).filter((x): x is string => !!x)
    },

    async elencaColonne(tabella: string): Promise<ColonnaSql[]> {
      const r = await pool
        .request()
        .input('nome', sql.NVarChar, `${quota('dbo')}.${quota(tabella)}`)
        .query<{ nome: string; tipo: string }>(`
          SELECT c.name AS nome, ty.name AS tipo
          FROM sys.columns c
          JOIN sys.types ty ON ty.user_type_id = c.user_type_id
          WHERE c.object_id = OBJECT_ID(@nome)
          ORDER BY c.column_id`)
      return r.recordset.map((x) => ({ nome: x.nome, tipo: x.tipo.toLowerCase() }))
    },

    leggiRighe(select: string): AsyncIterable<(string | null)[]> {
      return (async function* () {
        const request = pool.request()
        request.stream = true
        request.arrayRowMode = true
        const coda: (string | null)[][] = []
        let finito = false
        let errore: Error | null = null
        let sveglia: (() => void) | null = null
        const notifica = (): void => {
          const s = sveglia
          sveglia = null
          s?.()
        }
        request.on('row', (riga: (string | null)[]) => {
          coda.push(riga)
          if (coda.length >= CODA_MASSIMA) request.pause()
          notifica()
        })
        request.on('error', (e: Error) => {
          errore = e
          notifica()
        })
        request.on('done', () => {
          finito = true
          notifica()
        })
        request.query(select)
        try {
          for (;;) {
            if (coda.length > 0) {
              yield coda.shift() as (string | null)[]
              if (coda.length < CODA_MASSIMA / 2) request.resume()
              continue
            }
            if (errore) throw errore
            if (finito) return
            await new Promise<void>((r) => {
              sveglia = r
            })
          }
        } finally {
          if (!finito) request.cancel()
        }
      })()
    },

    async chiudi(): Promise<void> {
      await pool.close()
    },
  }
}
