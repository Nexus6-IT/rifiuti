import { randomInt } from 'crypto'
import { readFileSync } from 'fs'
import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  eliminaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiRisposta, percorsoApi } from '../../utils/attese'
import { chiama } from '../../utils/legami-api'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E della comunicazione O.R.R. Campania (4.9f D4), contro backend, Postgres e Redis reali.
 *
 * Azienda ENTERPRISE di prova con una sede a Napoli. Un carico ricevuto da terzi (FIR con
 * produttore e trasportatore terzi) e trasportato da noi: finisce in DUE file, il trasportatore
 * (`N<sede>MG<aa>T.txt`) e lo stoccaggio (`...S.txt`), da 718 byte per riga. Si prova anche:
 * il banner «da confermare», il bloccante con link (ATECO mancante), «segna inviata» con conferma
 * esplicita, il manifest e l'assenza del modulo.
 *
 * I dati (FIR, ditte, movimento) si preparano con il client del proprietario sull'azienda di prova;
 * restano nel database come gli altri spec (riconoscibili dal prefisso della run). Le comunicazioni
 * si cancellano per id esatti.
 */

const db = clientDbLocale()
const ANNO = new Date().getFullYear() - 1
const MESE = '05'
const COMUNE = { code: '063049', name: 'Napoli', sigla: 'NA' }

function numeroSito(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  const r = (n: number, s = A) =>
    Array.from({ length: n }, () => s[randomInt(s.length)]).join('')
  return `OP${r(4, '0123456789')}${r(3)}${r(6, '0123456789')}-NA${r(4, '0123456789')}`
}

test.describe('Comunicazione O.R.R. Campania', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si creano le aziende di prova'
  )
  test.describe.configure({ mode: 'serial' })

  let owner: PrismaClient
  let conModulo: AziendaDiTest
  let senzaModulo: AziendaDiTest
  let sedeId = ''
  let produttoreSedeId = ''
  let comuneCreato = false
  const comunicazioniIds: string[] = []
  const problemiPulizia: string[] = []

  test.beforeAll(async () => {
    owner = db!
    conModulo = await creaAziendaDiTest(owner, 'Orr con modulo', 'ENTERPRISE')
    senzaModulo = await creaAziendaDiTest(owner, 'Orr senza modulo', 'PROFESSIONAL')
    const tenantId = conModulo.tenantId
    const tk = await tokenAzienda(conModulo, 'admin')

    if (!(await owner.istatComune.findUnique({ where: { code: COMUNE.code } }))) {
      await owner.istatComune.create({
        data: { code: COMUNE.code, name: COMUNE.name, provinciaSigla: COMUNE.sigla },
      })
      comuneCreato = true
    }
    const tenant = await owner.tenant.update({
      where: { id: tenantId },
      data: { address: 'Corso Umberto', civico: '5', postalCode: '80133', city: 'Napoli', province: 'NA', atecoCode: '381100' },
    })

    const sede = await chiama<{ id: string }>('POST', '/rentri/unita-locali', tk, {
      numIscrSito: numeroSito(),
      denominazione: conPrefissoUnico('Sede O.R.R.'),
      principale: true,
    })
    expect(sede.stato, JSON.stringify(sede.corpo)).toBe(201)
    sedeId = sede.corpo.id
    const agg = await chiama('PUT', `/rentri/unita-locali/${sedeId}`, tk, {
      provincia: 'NA',
      comune: 'Napoli',
      cap: '80100',
      indirizzo: 'Z.I. Asi',
      civico: '8',
    })
    expect(agg.stato, JSON.stringify(agg.corpo)).toBe(200)
    const registri = await chiama<Array<{ id: string; unitaLocaleId: string | null }>>(
      'POST',
      '/registro/registri/assicura',
      tk
    )
    expect(registri.stato, JSON.stringify(registri.corpo)).toBe(200)
    const registro = registri.corpo.find(r => r.unitaLocaleId === sedeId)
    expect(registro, 'registro della sede').toBeTruthy()
    const unita = await owner.rentriUnitaLocale.findUniqueOrThrow({ where: { id: sedeId } })
    expect(unita.progressivoMud, 'progressivo MUD assegnato dal database').not.toBeNull()

    // Ditte di terzi: produttore e trasportatore, a Napoli.
    const ditta = async (nome: string, ateco: string | null) => {
      const d = await owner.ditta.create({
        data: { tenantId, ragioneSociale: conPrefissoUnico(nome), partitaIva: partitaIvaCasualeValida() },
      })
      const s = await owner.sedeDitta.create({
        data: {
          tenantId,
          dittaId: d.id,
          via: 'Via Roma',
          civico: '1',
          cap: '80100',
          comune: 'Napoli',
          provincia: 'NA',
          principale: true,
        },
      })
      await owner.anagraficaComunicazioniSede.create({
        data: {
          tenantId,
          sedeDittaId: s.id,
          codiceAteco: ateco,
          ...(nome.startsWith('Trasp')
            ? { alboDataIscrizione: new Date('2020-03-15T00:00:00Z'), alboClassi: '1 2 4' }
            : {}),
        },
      })
      return { dittaId: d.id, sedeId: s.id }
    }
    const prod = await ditta('Produttore O.R.R.', '38.21.09')
    produttoreSedeId = prod.sedeId
    const tra = await ditta('Trasportatore O.R.R.', null)
    const produttore = await owner.produttore.create({
      data: { tenantId, dittaId: prod.dittaId, sedeId: prod.sedeId },
    })
    void produttore
    const trasportatore = await owner.trasportatore.create({
      data: { tenantId, dittaId: tra.dittaId, sedeId: tra.sedeId, numeroIscrizione: 'NA012345' },
    })
    const aut = await owner.autorizzazioneImpianto.create({
      data: { tenantId, estremi: 'AUT-2019-0042', dataRilascio: new Date('2019-06-10T00:00:00Z') },
    })
    await chiama('PUT', `/comunicazioni/dati/sedi/${sedeId}/ORR`, tk, {
      tipoImpianto: 'STO',
      autorizzazioneImpiantoId: aut.id,
    })
    const fir = await owner.fIR.create({
      data: {
        tenantId,
        firNumber: 'AB1234567890123',
        status: 'COMPLETED',
        producerUserId: conModulo.userIds[0],
        producerSedeId: prod.sedeId,
        producerCodiceFiscale: 'PRDCFS80A01H501U',
        carrierCodiceFiscale: 'TRSCFS80A01H501U',
        receiverCodiceFiscale: 'DSTCFS80A01H501U',
        producerPartitaIva: '01234567890',
        producerName: 'Produttore O.R.R.',
        producerAddress: 'Via Roma 1, Napoli',
        carrierId: trasportatore.id,
        // Trasporto fatto da noi: stessa partita IVA dell'azienda.
        carrierPartitaIva: tenant.partitaIva,
        carrierName: 'Noi',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: tenant.partitaIva,
        receiverName: 'Impianto',
        receiverAddress: 'Z.I. Asi 8, Napoli',
        cerCode: '15 01 10*',
        wasteDescription: 'Imballaggi',
        wasteCategory: 'PERICOLOSO',
        quantity: 1250.5,
        wasteOperationType: 'RECOVERY',
        wasteOperationCode: 'R13',
        transportDate: new Date(`${ANNO}-${MESE}-10T08:00:00Z`),
      },
    })
    const quando = new Date(`${ANNO}-${MESE}-10T08:00:00Z`)
    await owner.wasteMovement.create({
      data: {
        tenantId,
        registroId: registro!.id,
        progressiveYear: ANNO,
        progressiveNumber: 1,
        type: 'CARICO',
        movementDate: quando,
        registrationDate: quando,
        causale: 'INGRESSO_ESTERNO',
        cerCode: '15 01 10*',
        quantity: 1250.5,
        unit: 'KG',
        firId: fir.id,
        operationCode: 'R13',
        wasteDescription: 'Imballaggi',
        tipoAnnotazione: 'ORDINARIA',
      },
    })
  })

  test.afterAll(async () => {
    if (!owner) return
    try {
      if (comunicazioniIds.length > 0) {
        await owner.comunicazioneConsorzioMovimento.deleteMany({
          where: { comunicazioneId: { in: comunicazioniIds } },
        })
        await owner.comunicazioneConsorzio.deleteMany({ where: { id: { in: comunicazioniIds } } })
      }
    } catch (e) {
      problemiPulizia.push(`comunicazioni: ${(e as Error).message.split('\n').pop()}`)
    }
    if (conModulo) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, conModulo)))
    if (senzaModulo) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, senzaModulo)))
    try {
      if (comuneCreato) await owner.istatComune.delete({ where: { code: COMUNE.code } })
    } catch (e) {
      problemiPulizia.push(`istat: ${(e as Error).message.split('\n').pop()}`)
    }
    if (problemiPulizia.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[orr] pulizia incompleta (warning): ${problemiPulizia.join(' | ')}`)
    }
    await owner.$disconnect()
  })

  async function scegliPeriodo(page: import('@playwright/test').Page) {
    const anteprima = page.waitForResponse(
      r =>
        percorsoApi(r.url())?.startsWith('/comunicazioni/orr/anteprima') === true &&
        new URL(r.url()).searchParams.get('da') === `${ANNO}-${MESE}-01` &&
        new URL(r.url()).searchParams.get('a') === `${ANNO}-${MESE}-31`,
      { timeout: ATTESA_SERVER }
    )
    anteprima.catch(() => undefined)
    await page.getByTestId('orr-anno').click()
    await page.getByRole('option', { name: String(ANNO), exact: true }).click()
    await page.getByTestId('orr-mese-da').click()
    await page.getByRole('option', { name: 'Maggio', exact: true }).click()
    await page.getByTestId('orr-mese-a').click()
    await page.getByRole('option', { name: 'Maggio', exact: true }).click()
    expect((await anteprima).status()).toBe(200)
  }

  test('bloccante con link, poi due file T e S da 718 byte, manifest, segna inviata con conferma', async ({ page }) => {
    // ATECO del produttore mancante: bloccante.
    await owner.anagraficaComunicazioniSede.update({
      where: { tenantId_sedeDittaId: { tenantId: conModulo.tenantId, sedeDittaId: produttoreSedeId } },
      data: { codiceAteco: null },
    })
    await accediUiComeAzienda(page, conModulo, 'admin')
    await page.goto('/comunicazioni/orr')
    await expect(page.getByTestId('orr-banner-ricavato')).toContainText('da confermare con un file reale')
    await scegliPeriodo(page)
    await expect(page.getByTestId('orr-file-STO')).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(page.getByTestId('orr-bloccanti')).toBeVisible()
    await expect(page.getByTestId('orr-genera')).toBeDisabled()
    await expect(page.getByTestId('orr-file-avviso').first()).toContainText('codice ATECO')
    await expect(page.getByTestId('orr-correzione').first()).toContainText('anagrafica della sede')

    // Si corregge l'anagrafica e si ricarica: due file, trasportatore e stoccaggio.
    await owner.anagraficaComunicazioniSede.update({
      where: { tenantId_sedeDittaId: { tenantId: conModulo.tenantId, sedeDittaId: produttoreSedeId } },
      data: { codiceAteco: '38.21.09' },
    })
    await page.reload()
    await scegliPeriodo(page)
    await expect(page.getByTestId('orr-file-TRA')).toContainText('1 record da 1 movimenti', { timeout: ATTESA_SERVER })
    await expect(page.getByTestId('orr-file-STO')).toContainText('1 record da 1 movimenti')
    await expect(page.getByTestId('orr-bloccanti')).toHaveCount(0)

    const genera = page.getByTestId('orr-genera')
    await expect(genera).toBeEnabled()
    const risposta = await attendiRisposta(page, () => genera.click(), {
      metodo: 'POST',
      percorso: '/comunicazioni/orr',
    })
    const corpo = (await risposta.json()) as { file: Array<{ id: string; nomeFile: string; attivita: string }> }
    for (const f of corpo.file) comunicazioniIds.push(f.id)
    expect(corpo.file.map(f => f.attivita).sort()).toEqual(['STO', 'TRA'])
    const progressivo = String(
      (await owner.rentriUnitaLocale.findUniqueOrThrow({ where: { id: sedeId } })).progressivoMud
    ).padStart(4, '0')
    const aa = String(ANNO % 100).padStart(2, '0')
    expect(corpo.file.map(f => f.nomeFile).sort()).toEqual([
      `N${progressivo}MG${aa}S.txt`,
      `N${progressivo}MG${aa}T.txt`,
    ])

    const storico = page.getByTestId('orr-storico-riga')
    await expect(storico).toHaveCount(2, { timeout: ATTESA_SERVER })
    await expect(page.getByTestId('orr-storico-da-confermare').first()).toBeVisible()

    // Scarica il file T: 718 byte (un record con CRLF), tipo dichiarante TRA in posizione 30.
    const rigaT = storico.filter({ hasText: 'T.txt' })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: ATTESA_SERVER }),
      rigaT.getByTestId('orr-scarica').click(),
    ])
    const percorso = await download.path()
    expect(percorso).toBeTruthy()
    const contenuto = readFileSync(percorso!)
    expect(contenuto.length).toBe(718)
    expect(contenuto.subarray(29, 32).toString('latin1')).toBe('TRA')
    expect(contenuto.subarray(716, 718).toString('latin1')).toBe('\r\n')

    // Manifest: testo con l'avvertenza.
    const [dm] = await Promise.all([
      page.waitForEvent('download', { timeout: ATTESA_SERVER }),
      rigaT.getByTestId('orr-manifest').click(),
    ])
    expect(readFileSync((await dm.path())!, 'utf8')).toContain('da confermare con un file reale')

    // Segna inviata: serve la conferma esplicita.
    await rigaT.getByTestId('orr-segna-inviata').click()
    await expect(page.getByText('Ho verificato che il consorzio accetta questo file').first()).toBeVisible()
    await attendiRisposta(
      page,
      () => page.getByRole('button', { name: 'Ho verificato, segna inviata', exact: true }).click(),
      { metodo: 'POST', percorso: '/inviata' }
    )
    await expect(storico.filter({ hasText: 'T.txt' })).toContainText('Inviata', { timeout: ATTESA_SERVER })
  })

  test('senza il modulo: la pagina non si apre e nessuna chiamata riceve 403', async ({ page }) => {
    const respinte: string[] = []
    page.on('response', r => {
      if (r.status() === 403 && percorsoApi(r.url())) respinte.push(percorsoApi(r.url())!)
    })
    await accediUiComeAzienda(page, senzaModulo, 'admin')
    await page.goto('/comunicazioni/orr')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: ATTESA_SERVER })
    await page.waitForLoadState('networkidle')
    expect(respinte, 'nessuna chiamata respinta con 403').toEqual([])
  })
})
