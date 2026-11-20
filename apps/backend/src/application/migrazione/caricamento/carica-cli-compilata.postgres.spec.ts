/**
 * Pezzo I2, criterio di fatto: un pacchetto sintetico di sole ditte si carica due volte con la CLI
 * COMPILATA (`node dist/cli/migrazione-carica.js`, niente ts-node: come nell'immagine del backend);
 * la seconda volta salta tutto.
 *
 * Opt-in: serve `npm run build` prima. Lancio:
 *   WASTEFLOW_TEST_CLI_COMPILATA=1 npx jest -c jest.postgres.config.js carica-cli-compilata
 */
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import { PrismaClient } from '@prisma/client'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { mappaValida } from '../../../test-support/migrazione/mappa-di-prova'
import { scriviStagingDitteProva } from '../../../test-support/migrazione/staging-ditte-di-prova'

const eseguiCompilata = process.env.WASTEFLOW_TEST_CLI_COMPILATA === '1'
const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
const DIST = join(__dirname, '..', '..', '..', '..', 'dist', 'cli')
const run = promisify(execFile)

;(eseguiCompilata ? describe : describe.skip)(
  'CLI compilata (dist/cli) — prepara e carica due volte',
  () => {
    const owner = new PrismaClient({ datasourceUrl: urlProprietario })
    let radice: string
    let tenantId: string

    beforeAll(async () => {
      expect(existsSync(join(DIST, 'migrazione-carica.js'))).toBe(true)
      radice = await mkdtemp(join(tmpdir(), 'cli-compilata-'))
      tenantId = (
        await owner.tenant.create({
          data: {
            partitaIva: partitaIvaUnica(),
            ragioneSociale: 'CLI compilata SRL',
            country: 'IT',
          },
        })
      ).id
    })
    afterAll(async () => {
      await cancellaAziendeDiProva(owner, tenantId)
      await owner.$disconnect()
      await rm(radice, { recursive: true, force: true })
    })

    it('prepara sulla workstation, carica due volte: 2 inserite, poi 2 saltate', async () => {
      const prova = await scriviStagingDitteProva(
        join(radice, 'staging'),
        4_900_000 + (Date.now() % 90_000)
      )
      const gia = await owner.ditta.create({
        data: { tenantId, ragioneSociale: 'GIA PRESENTE', partitaIva: prova.pivaAgganciata },
      })
      const { writeFile } = await import('fs/promises')
      const mappaFile = join(radice, 'mappa-import.json')
      await writeFile(
        mappaFile,
        JSON.stringify({
          ...mappaValida(),
          tenantId,
          registri: [],
          unitaLocali: [],
          causali: [],
          agganci: [{ partitaIva: prova.pivaAgganciata, dittaId: gia.id }],
        })
      )
      const env = { ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv
      const prep = await run(
        'node',
        [
          join(DIST, 'migrazione-prepara.js'),
          prova.cartella,
          '--mappa',
          mappaFile,
          '--destinazione',
          join(radice, 'pacchetto'),
        ],
        { env }
      )
      expect(prep.stdout).toContain('ANAGRAFICHE/ditte: 2 righe')

      const urlApp = urlComeRuolo(
        'wasteflow_app',
        process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
        urlProprietario
      )
      const carica = (...extra: string[]) =>
        run(
          'node',
          [
            join(DIST, 'migrazione-carica.js'),
            '--tenant',
            tenantId,
            '--pacchetto',
            join(radice, 'pacchetto', 'WW00012026'),
            '--ambito',
            'ANAGRAFICHE',
            ...extra,
          ],
          { env: { ...env, DATABASE_URL: urlApp } }
        )
      const verifica = await carica('--verifica')
      expect(verifica.stdout).toContain('verifica: nessun bloccante')
      const primo = await carica()
      expect(primo.stdout).toContain('lette: 2; inserite: 2; saltate: 0')
      const secondo = await carica()
      expect(secondo.stdout).toContain('lette: 2; inserite: 0; saltate: 2')
      expect(await owner.ditta.count({ where: { tenantId, importSource: 'WINWASTE' } })).toBe(2)
    }, 120_000)
  }
)
