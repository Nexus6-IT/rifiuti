import { readFileSync } from 'fs'
import { test, expect, type Page } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  eliminaAziendaDiTest,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiAbilitato, attendiRisposta, percorsoApi } from '../../utils/attese'
import { giornoItaliano } from '../../utils/legami-api'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E delle comunicazioni CONOU e COBAT (4.9c-d, B7), contro backend, Postgres e Redis reali.
 *
 * Due aziende di prova: ENTERPRISE (ha il modulo `comunicazioni`) e PROFESSIONAL (non lo ha).
 * I dati di partenza (sede, ditte, FIR, movimenti del mese scorso, ATECO della controparte) si
 * scrivono col client del proprietario; la configurazione della sede si compila dall'interfaccia.
 * Poi: anteprima senza bloccanti, genera, scarica il file (riga di 299 byte con CRLF per il CONOU,
 * record di 1628 byte per il COBAT, byte 0xE0 per `à`), scarica il manifest («ricavato da
 * WinWaste»), «segna inviata» con la conferma di verifica, e una modifica dei dati dopo l'invio
 * («modificata dopo l'invio»). Senza il modulo: la pagina non si apre e nessuna chiamata da' 403.
 *
 * Pulizia per id esatti, con warning se un dato immutabile (movimenti) non si puo' cancellare.
 */

const db = clientDbLocale()
const MESSAGGIO = "Il modulo non è attivo per l'azienda selezionata."
const COD_PROVINCIA = '998'
const COD_COMUNE = '998001'

/** Mese precedente a oggi (giorno di Roma): `AAAA-MM`. */
function mesePrecedenteIso(): { anno: number; mese: string } {
  const oggi = giornoItaliano()
  let anno = Number(oggi.slice(0, 4))
  let mese = Number(oggi.slice(5, 7)) - 1
  if (mese === 0) {
    mese = 12
    anno -= 1
  }
  return { anno, mese: String(mese).padStart(2, '0') }
}

function numeroSito(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  const r = (n: number, s = A) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `OP${r(4, '0123456789')}${r(3)}${r(6, '0123456789')}-MI${r(4, '0123456789')}`
}

test.describe('Comunicazioni CONOU e COBAT', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si creano le aziende di prova'
  )
  test.describe.configure({ mode: 'serial' })

  let owner: PrismaClient
  let conModulo: AziendaDiTest
  let senzaModulo: AziendaDiTest
  let sedeId = ''
  let registroId = ''
  const sedeDittaIds: string[] = []
  const firIds: string[] = []
  const comunicazioniIds: string[] = []
  const problemiPulizia: string[] = []
  const { anno, mese } = mesePrecedenteIso()
  const giorno = (g: number) => `${anno}-${mese}-${String(g).padStart(2, '0')}`

  async function creaDitta(nome: string, piva: string, comune = 'Cittaprova') {
    const tenantId = conModulo.tenantId
    const ditta = await owner.ditta.create({
      data: { tenantId, ragioneSociale: nome, partitaIva: piva, codiceFiscale: piva },
    })
    const sede = await owner.sedeDitta.create({
      data: {
        tenantId,
        dittaId: ditta.id,
        via: 'Via Roma',
        civico: '12',
        cap: '24100',
        comune,
        provincia: 'ZZ',
        principale: true,
      },
    })
    sedeDittaIds.push(sede.id)
    return { dittaId: ditta.id, sedeId: sede.id }
  }

  async function creaFir(o: {
    numero: string
    produttoreSedeId: string
    destinatarioSedeId?: string
    destinatarioNoi?: boolean
    cer: string
    conTrasportatore: boolean
  }) {
    const tenant = await owner.tenant.findUniqueOrThrow({ where: { id: conModulo.tenantId } })
    const fir = await owner.fIR.create({
      data: {
        tenantId: conModulo.tenantId,
        firNumber: o.numero,
        status: 'COMPLETED',
        producerUserId: conModulo.userIds[0],
        producerSedeId: o.produttoreSedeId,
        receiverSedeId: o.destinatarioNoi ? null : (o.destinatarioSedeId ?? null),
        producerCodiceFiscale: '05555555555',
        carrierCodiceFiscale: o.conTrasportatore ? '09876543210' : null,
        receiverCodiceFiscale: o.destinatarioNoi ? tenant.partitaIva : '11122233344',
        producerPartitaIva: '05555555555',
        producerName: 'Officina Bianchi di Città',
        producerAddress: 'Via Roma 12, Cittaprova',
        carrierPartitaIva: o.conTrasportatore ? '09876543210' : '',
        carrierName: o.conTrasportatore ? 'Trasporti Rapidi SRL' : '',
        carrierVehiclePlate: o.conTrasportatore ? 'AB123CD' : '',
        receiverPartitaIva: o.destinatarioNoi ? tenant.partitaIva : '11122233344',
        receiverName: o.destinatarioNoi ? tenant.ragioneSociale : 'Recuperi SPA',
        receiverAddress: 'Via Po 2, Cittaprova',
        cerCode: o.cer,
        wasteDescription: 'Rifiuto di prova',
        wasteCategory: 'PERICOLOSO',
        quantity: 100,
        wasteOperationType: 'RECOVERY',
        wasteOperationCode: 'R13',
        transportDate: new Date(`${giorno(9)}T08:00:00Z`),
      },
    })
    firIds.push(fir.id)
    return fir.id
  }

  let progressivo = 0
  async function creaMovimento(o: {
    tipo: 'CARICO' | 'SCARICO'
    giorno: number
    cer: string
    kg: number
    firId: string
    operationCode?: string
  }) {
    const quando = new Date(`${giorno(o.giorno)}T08:00:00Z`)
    await owner.wasteMovement.create({
      data: {
        tenantId: conModulo.tenantId,
        registroId,
        progressiveYear: anno,
        progressiveNumber: ++progressivo,
        type: o.tipo,
        movementDate: quando,
        registrationDate: quando,
        causale: o.tipo === 'CARICO' ? 'INGRESSO_ESTERNO' : 'AVVIO_RECUPERO',
        cerCode: o.cer,
        quantity: o.kg,
        unit: 'KG',
        firId: o.firId,
        operationCode: o.operationCode ?? null,
        tipoAnnotazione: 'ORDINARIA',
      },
    })
  }

  /** Configurazione della sede dall'interfaccia: pagina O.R.SO., sezione «configurazione della sede». */
  async function configuraDaUi(
    page: Page,
    consorzio: 'CONOU' | 'COBAT',
    compila: () => Promise<void>
  ) {
    await page.goto('/comunicazioni')
    await page.locator('#config-consorzio').selectOption(consorzio)
    await expect(page.getByTestId('config-salva')).toBeVisible({ timeout: ATTESA_SERVER })
    await compila()
    await attendiRisposta(page, () => page.getByTestId('config-salva').click(), {
      metodo: 'PUT',
      percorso: '/comunicazioni/dati/sedi/',
    })
  }

  /** Scarica il file dal primo elemento dello storico. */
  async function scaricaBytes(page: Page, testid: string): Promise<Buffer> {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: ATTESA_SERVER }),
      page.getByTestId(testid).first().click(),
    ])
    const percorso = await download.path()
    expect(percorso).toBeTruthy()
    return readFileSync(percorso!)
  }

  async function apriTracciato(page: Page, consorzio: 'CONOU' | 'COBAT') {
    const risposta = page.waitForResponse(
      r =>
        percorsoApi(r.url())?.startsWith(`/comunicazioni/${consorzio.toLowerCase()}/anteprima`) ===
        true,
      { timeout: ATTESA_SERVER }
    )
    risposta.catch(() => undefined)
    await page.goto('/comunicazioni/consorzi')
    if (consorzio === 'COBAT') {
      await page.getByTestId('tracciati-scegli-COBAT').click()
      const cobat = await page.waitForResponse(
        r => percorsoApi(r.url())?.startsWith('/comunicazioni/cobat/anteprima') === true,
        { timeout: ATTESA_SERVER }
      )
      expect(cobat.status()).toBe(200)
    } else {
      expect((await risposta).status()).toBe(200)
    }
  }

  test.beforeAll(async () => {
    owner = db!
    conModulo = await creaAziendaDiTest(owner, 'Conou con modulo', 'ENTERPRISE')
    senzaModulo = await creaAziendaDiTest(owner, 'Conou senza modulo', 'PROFESSIONAL')
    // ISTAT di prova: provincia ZZ e un comune fittizio (tolti a fine prova).
    await owner.istatProvincia.upsert({
      where: { sigla: 'ZZ' },
      create: {
        sigla: 'ZZ',
        code: COD_PROVINCIA,
        name: 'Provincia di prova',
        regione: 'Lombardia',
      },
      update: {},
    })
    await owner.istatComune.upsert({
      where: { code: COD_COMUNE },
      create: { code: COD_COMUNE, name: 'Cittaprova', provinciaSigla: 'ZZ', cap: '24100' },
      update: {},
    })
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: conModulo.tenantId,
        numIscrSito: numeroSito(),
        denominazione: conPrefissoUnico('Sede CONOU'),
        principale: true,
        indirizzo: 'Via delle Officine',
        civico: '5',
        cap: '24100',
        comune: 'Cittaprova',
        provincia: 'ZZ',
      },
    })
    sedeId = sede.id
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: conModulo.tenantId,
        descrizione: 'Registro di prova',
        unitaLocaleId: sedeId,
      },
    })
    registroId = registro.id

    const produttore = await creaDitta('Officina Bianchi di Città', '05555555555')
    const destinatario = await creaDitta('Recuperi SPA', '11122233344')
    await owner.anagraficaComunicazioniSede.createMany({
      data: [
        { tenantId: conModulo.tenantId, sedeDittaId: produttore.sedeId, codiceAteco: '45.20.10' },
        { tenantId: conModulo.tenantId, sedeDittaId: destinatario.sedeId, codiceAteco: '38.12.00' },
      ],
    })
    // CONOU: un carico e uno scarico di olio (CER 13 02 05*), entrambi con FIR e trasportatore.
    const firOlio = await creaFir({
      numero: 'ABC123/26',
      produttoreSedeId: produttore.sedeId,
      destinatarioSedeId: destinatario.sedeId,
      cer: '13 02 05*',
      conTrasportatore: true,
    })
    await creaMovimento({ tipo: 'CARICO', giorno: 10, cer: '13 02 05*', kg: 1500, firId: firOlio })
    await creaMovimento({
      tipo: 'SCARICO',
      giorno: 12,
      cer: '13 02 05*',
      kg: 1000,
      firId: firOlio,
      operationCode: 'R13',
    })
    // COBAT: un carico di batterie (CER 16 06 01*) da terzi, destinatario l'azienda, senza trasportatore.
    const firBatterie = await creaFir({
      numero: 'XYZ456/26',
      produttoreSedeId: produttore.sedeId,
      destinatarioNoi: true,
      cer: '16 06 01*',
      conTrasportatore: false,
    })
    await creaMovimento({
      tipo: 'CARICO',
      giorno: 14,
      cer: '16 06 01*',
      kg: 1250,
      firId: firBatterie,
      operationCode: 'R13',
    })
  })

  test.afterAll(async () => {
    if (!owner) return
    const passo = async (nome: string, f: () => Promise<unknown>) => {
      try {
        await f()
      } catch (e) {
        problemiPulizia.push(`${nome}: ${(e as Error).message.split('\n').pop()}`)
      }
    }
    const where = { tenantId: conModulo?.tenantId ?? '' }
    if (conModulo) {
      await passo('comunicazioni', async () => {
        const righe = await owner.comunicazioneConsorzio.findMany({ where, select: { id: true } })
        comunicazioniIds.push(...righe.map(r => r.id))
        await owner.comunicazioneConsorzioMovimento.deleteMany({
          where: { comunicazioneId: { in: comunicazioniIds } },
        })
        await owner.comunicazioneConsorzio.deleteMany({ where: { id: { in: comunicazioniIds } } })
      })
      await passo('configurazioni', () =>
        owner.configurazioneComunicazioneSede.deleteMany({ where })
      )
      await passo('dati tracciato', () => owner.datiTracciatoMovimento.deleteMany({ where }))
      await passo('anagrafica comunicazioni', () =>
        owner.anagraficaComunicazioniSede.deleteMany({ where })
      )
      await passo('movimenti', () => owner.wasteMovement.deleteMany({ where }))
      await passo('FIR', () => owner.fIR.deleteMany({ where: { id: { in: firIds } } }))
      await passo('sedi ditte', () =>
        owner.sedeDitta.deleteMany({ where: { id: { in: sedeDittaIds } } })
      )
      await passo('ditte', () => owner.ditta.deleteMany({ where }))
      await passo('registro', () => owner.registroRifiuti.deleteMany({ where }))
      await passo('sede', () => owner.rentriUnitaLocale.deleteMany({ where }))
      problemiPulizia.push(...(await eliminaAziendaDiTest(owner, conModulo)))
    }
    if (senzaModulo) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, senzaModulo)))
    await passo('istat', async () => {
      await owner.istatComune.deleteMany({ where: { code: COD_COMUNE } })
      await owner.istatProvincia.deleteMany({ where: { code: COD_PROVINCIA } })
    })
    if (problemiPulizia.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[conou-cobat] pulizia incompleta (warning): ${problemiPulizia.join(' | ')}`)
    }
    await owner.$disconnect()
  })

  test('CONOU: configurazione, anteprima, genera, file da 299 byte, manifest, segna inviata, modifica dopo l invio', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, conModulo, 'admin')
    await configuraDaUi(page, 'CONOU', async () => {
      await page.locator('#config-deposito').fill('BG001')
      await page.getByTestId('config-predefinito-aggiungi').click()
      await page.getByLabel('CER della riga 1').fill('130205')
      await page.getByLabel('Percentuale di olio della riga 1').fill('84.99')
    })

    await apriTracciato(page, 'CONOU')
    await expect(page.getByTestId('tracciato-banner')).toContainText(
      'Tracciato ricavato da WinWaste, da confermare con un file reale',
      { timeout: ATTESA_SERVER }
    )
    await expect(page.getByTestId('tracciato-riepilogo')).toContainText('2 record da 2 movimenti')
    await expect(page.getByTestId('tracciato-bloccanti')).toHaveCount(0)

    const genera = page.getByTestId('tracciato-genera')
    await attendiAbilitato(genera)
    const risposta = await attendiRisposta(page, () => genera.click(), {
      metodo: 'POST',
      percorso: '/comunicazioni/conou',
    })
    comunicazioniIds.push(((await risposta.json()) as { id: string }).id)
    const storico = page.getByTestId('tracciato-storico-riga')
    await expect(storico).toHaveCount(1, { timeout: ATTESA_SERVER })
    await expect(storico.first()).toContainText('Generata')
    await expect(page.getByTestId('tracciato-etichetta')).toBeVisible()

    // File: righe di 299 byte con CRLF; `à` e` il byte 0xE0 (Windows-1252), non UTF-8.
    const file = await scaricaBytes(page, 'tracciato-scarica')
    const righe = file.toString('latin1').split('\r\n').filter(Boolean)
    expect(righe).toHaveLength(2)
    for (const r of righe) expect(r).toHaveLength(299)
    expect(file.length).toBe(2 * 301)
    expect(file.includes(0xe0)).toBe(true)
    expect(file.includes(0xc3)).toBe(false)
    expect(righe[0].slice(268, 274)).toBe('130205')
    expect(righe[0].slice(198, 208).trim()).toBe('BG001')

    // Manifest
    const manifest = (await scaricaBytes(page, 'tracciato-manifest')).toString('utf8')
    expect(manifest).toContain('da confermare con un file reale')

    // Segna inviata: serve la conferma di verifica.
    await page.getByTestId('tracciato-segna-inviata').first().click()
    await attendiRisposta(
      page,
      () => page.getByRole('button', { name: /Ho verificato che il consorzio accetta/ }).click(),
      { metodo: 'POST', percorso: '/inviata' }
    )
    await expect(storico.first()).toContainText('Inviata', { timeout: ATTESA_SERVER })

    // Una modifica dei dati dopo l'invio (percentuale di olio predefinita) la segnala.
    const config = await owner.configurazioneComunicazioneSede.findFirstOrThrow({
      where: { tenantId: conModulo.tenantId, unitaLocaleId: sedeId, consorzio: 'CONOU' },
    })
    await owner.configurazioneComunicazioneSede.update({
      where: { id: config.id },
      data: {
        dati: {
          ...(config.dati as object),
          predefinitiPerCer: { '130205': { prodotto: 'A', percentualeOlio: 70 } },
        },
      },
    })
    await apriTracciato(page, 'CONOU')
    await expect(page.getByTestId('tracciato-modificata')).toBeVisible({ timeout: ATTESA_SERVER })
  })

  test('COBAT: configurazione, anteprima, genera, record da 1628 byte, manifest, segna inviata', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, conModulo, 'admin')
    await configuraDaUi(page, 'COBAT', async () => {
      await page.locator('#config-camp-codice').fill('01')
      await page.locator('#config-camp-desc').fill('Campagna prova')
      await page.getByTestId('config-pgf-aggiungi').click()
      await page.getByLabel('CER della riga 1').fill('160601')
    })

    await apriTracciato(page, 'COBAT')
    await expect(page.getByTestId('tracciato-banner')).toContainText(
      'da confermare con un file reale',
      {
        timeout: ATTESA_SERVER,
      }
    )
    await expect(page.getByTestId('tracciato-riepilogo')).toContainText('1 record da 1 movimenti')
    await expect(page.getByTestId('tracciato-bloccanti')).toHaveCount(0)

    const genera = page.getByTestId('tracciato-genera')
    await attendiAbilitato(genera)
    const risposta = await attendiRisposta(page, () => genera.click(), {
      metodo: 'POST',
      percorso: '/comunicazioni/cobat',
    })
    comunicazioniIds.push(((await risposta.json()) as { id: string }).id)
    const storico = page.getByTestId('tracciato-storico-riga')
    await expect(storico).toHaveCount(1, { timeout: ATTESA_SERVER })

    const file = await scaricaBytes(page, 'tracciato-scarica')
    expect(file.length).toBe(1628)
    const testo = file.toString('latin1')
    expect(testo.slice(30, 31)).toBe('3') // carico da terzi, nessun trasportatore esterno
    expect(testo.slice(136, 142)).toBe('160601')
    expect(testo.slice(1409, 1628)).toBe(`${' '.repeat(185)}01${'Campagna prova'.padEnd(30)}\r\n`)
    expect(file.includes(0xe0)).toBe(true) // la ragione sociale del produttore ha `à`

    const manifest = (await scaricaBytes(page, 'tracciato-manifest')).toString('utf8')
    expect(manifest).toContain('da confermare con un file reale')

    await page.getByTestId('tracciato-segna-inviata').first().click()
    await attendiRisposta(
      page,
      () => page.getByRole('button', { name: /Ho verificato che il consorzio accetta/ }).click(),
      { metodo: 'POST', percorso: '/inviata' }
    )
    await expect(storico.first()).toContainText('Inviata', { timeout: ATTESA_SERVER })
  })

  test('senza il modulo: la pagina non si apre e nessuna chiamata riceve 403', async ({ page }) => {
    const respinte: string[] = []
    page.on('response', r => {
      if (r.status() === 403 && percorsoApi(r.url())) respinte.push(percorsoApi(r.url())!)
    })
    await accediUiComeAzienda(page, senzaModulo, 'admin')
    await page.goto('/comunicazioni/consorzi')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: ATTESA_SERVER })
    await expect(page.getByText(MESSAGGIO).first()).toBeVisible({ timeout: ATTESA_SERVER })
    await page.waitForLoadState('networkidle')
    expect(respinte, 'nessuna chiamata respinta con 403').toEqual([])
  })
})
