import * as fs from 'fs'
import * as path from 'path'
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { AppModule } from '../app.module'

/**
 * Guardia contro l'esecuzione di comandi di sistema dal backend.
 *
 * `POST /backup/restore?filename=` concatenava il parametro in un comando
 * `pg_restore` eseguito con `exec` di `child_process`, cioè dentro una shell:
 * chi aveva il ruolo SUPER_ADMIN (o il suo token) poteva eseguire comandi
 * arbitrari nel container. Gli endpoint di backup non funzionavano neppure,
 * perché l'immagine non contiene `pg_dump`/`pg_restore`: i backup si fanno
 * sul server, fuori dall'applicazione.
 *
 * I due test leggono la METADATA dei decoratori via `Reflect` e il sorgente
 * su disco: nessuna istanza creata, nessuna connessione aperta.
 */

type ModuloNest = { module?: unknown } | (new (...args: unknown[]) => unknown)

function controllerRaggiungibili(radice: unknown): unknown[] {
  const visti = new Set<unknown>()
  const controller: unknown[] = []
  const coda: unknown[] = [radice]
  while (coda.length > 0) {
    let corrente = coda.shift() as ModuloNest | undefined
    if (corrente && typeof corrente === 'object' && 'module' in corrente) {
      corrente = corrente.module as ModuloNest
    }
    if (!corrente || visti.has(corrente)) continue
    visti.add(corrente)
    controller.push(
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, corrente) as unknown[]) ?? [])
    )
    coda.push(...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, corrente) as unknown[]) ?? []))
  }
  return controller
}

function sorgentiDiProduzione(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(voce => {
    const completo = path.join(dir, voce.name)
    if (voce.isDirectory()) return sorgentiDiProduzione(completo)
    return voce.name.endsWith('.ts') && !voce.name.endsWith('.spec.ts') ? [completo] : []
  })
}

describe('nessuna shell esposta dal backend', () => {
  it('nessun controller raggiungibile da AppModule risponde sotto /backup', () => {
    const percorsi = controllerRaggiungibili(AppModule).map(
      c => Reflect.getMetadata(PATH_METADATA, c as object) as string | undefined
    )

    expect(percorsi.length).toBeGreaterThan(10)
    expect(percorsi.filter(p => String(p).replace(/^\//, '').split('/')[0] === 'backup')).toEqual(
      []
    )
  })

  it('nessun file di produzione importa child_process', () => {
    const radice = path.resolve(__dirname, '..')
    const colpevoli = sorgentiDiProduzione(radice)
      .filter(f =>
        /from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]\s*\)/.test(
          fs.readFileSync(f, 'utf8')
        )
      )
      .map(f => path.relative(radice, f))

    expect(colpevoli).toEqual([])
  })
})
