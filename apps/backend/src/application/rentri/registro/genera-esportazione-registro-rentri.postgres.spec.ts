/**
 * GeneraEsportazioneRegistroRentriUseCase (eREGI E6, T1) contro un Postgres reale, COME
 * `wasteflow_app` (RLS) dentro il `TenantContext`. I client RENTRI sono finti (nessuna rete): qui si
 * prova la logica sul database, la catena dei digest e la ricostruzione dai soli dati salvati. La
 * validazione verso RENTRI con la fake e' in `esportazioni-registro-rentri.oracolo.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { gunzipSync } from 'zlib'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { TenantSenzaCertificatoRentriError } from '../../../infrastructure/rentri/rentri-credential.resolver'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import {
  DATA_RICHIESTA_EREGI,
  DIGEST_EREGI,
  aggiungiAnnotazioni,
  eregiDiProva,
  materialeFirmaDiProva,
  scenarioEsportazioni,
  type ScenarioEsportazioni,
} from '../../../test-support/esportazioni-registro-di-prova'
import { validaXmlRegistro } from '../../../infrastructure/rentri/valida-xml-registro'
import {
  CatenaEsportazioniNonCoerenteError,
  EregiNonDisponibileError,
  EsportazioneRifiutataInCatenaError,
} from './errori-esportazioni-registro-rentri'
import {
  RegistroRentriChiusoError,
  RegistroNonCollegatoRentriError,
} from './errori-azioni-rentri-registro'
import { GeneraEsportazioneRegistroRentriUseCase } from './genera-esportazione-registro-rentri.use-case'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import {
  traduciAnnotazione,
  type AnnotazionePerRentri,
  type EsitoTraduzione,
} from './mappa-registrazione-rentri'
import { verificaCatenaEsportazioni } from './verifica-catena-esportazioni'

describe('GeneraEsportazioneRegistroRentriUseCase — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  let eregXml = eregiDiProva()
  let scaricaVidimazioneXml: jest.Mock
  let resolve: jest.Mock
  let valida: jest.Mock
  /** Progressivi (anno-progressivo) che il traduttore finto dichiara non traducibili. */
  let nonTraducibili: Set<string>

  function creaUseCase(tetto?: number): GeneraEsportazioneRegistroRentriUseCase {
    const traduttore = (a: AnnotazionePerRentri): EsitoTraduzione =>
      nonTraducibili.has(`${a.numero.anno}-${a.numero.progressivo}`)
        ? { ok: false, motivi: ['Dato mancante di prova'] }
        : traduciAnnotazione(a)
    return new GeneraEsportazioneRegistroRentriUseCase(
      app,
      new LettoreAnnotazioniRentri(logger),
      { scaricaVidimazioneXml } as any,
      { resolve } as any,
      { valida } as any,
      logger,
      traduttore,
      tetto
    )
  }

  async function scenario(opzioni?: { collegato?: boolean }): Promise<ScenarioEsportazioni> {
    const s = await scenarioEsportazioni(owner, opzioni)
    tenantCreati.push(s.tenantId)
    return s
  }

  const genera = (s: ScenarioEsportazioni, creataDa: string | null = null) =>
    creaUseCase().genera(s.tenantId, s.registroId, { creataDa, valida: false })

  const righe = (s: ScenarioEsportazioni) =>
    owner.esportazioneRegistroRentri.findMany({
      where: { registroId: s.registroId },
      orderBy: { createdAt: 'asc' },
    })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  beforeEach(() => {
    nonTraducibili = new Set()
    eregXml = eregiDiProva()
    scaricaVidimazioneXml = jest.fn().mockImplementation(async () => ({
      nomeFile: 'ereg.xml',
      mime: 'application/xml',
      xml: eregXml,
    }))
    resolve = jest.fn().mockResolvedValue({ ...materialeFirmaDiProva(), source: 'tenant' })
    valida = jest.fn().mockResolvedValue(undefined)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('prima esportazione: intervallo 1-3, solo il Ref dell eREGI, firmata, eREGI salvato sul registro', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 3)
    const esito = await genera(s, s.userId)
    expect(esito.esito).toBe('CREATA')
    if (esito.esito !== 'CREATA') return
    expect(esito.fermataA).toBeNull()
    expect(esito.esportazione).toMatchObject({
      anno: 2026,
      progressivoDa: 1,
      progressivoA: 3,
      numeroRegistrazioni: 3,
      stato: 'GENERATA',
      firmato: true,
      precedenteId: null,
    })

    const [riga] = await righe(s)
    expect(riga.creataDa).toBe(s.userId)
    expect(riga.certificatoSha256).toMatch(/^[0-9a-f]{64}$/)
    const xml = gunzipSync(Buffer.from(riga.xml)).toString('utf8')
    expect(xml).toContain(
      `<reg:Ref DigestValue="${DIGEST_EREGI}" DataCreazione="${DATA_RICHIESTA_EREGI}"/>`
    )
    expect(xml.match(/<reg:Ref /g)).toHaveLength(1)
    expect(xml.match(/<mov:Autore>Mario Rossi<\/mov:Autore>/g)).toHaveLength(3)
    expect((await validaXmlRegistro(xml)).valido).toBe(true)

    const registro = await owner.registroRifiuti.findUniqueOrThrow({ where: { id: s.registroId } })
    expect(registro.eregXml).toBe(eregXml)
    expect(registro.eregDigest).toBe(DIGEST_EREGI)
    expect(scaricaVidimazioneXml).toHaveBeenCalledTimes(1)
  })

  it('catena di 3 esportazioni (con cambio d anno), ricostruibile dai soli dati salvati', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 3)
    await genera(s)
    await aggiungiAnnotazioni(owner, s, 2026, 4, 5)
    await genera(s)
    await aggiungiAnnotazioni(owner, s, 2027, 1, 2)
    const terza = await genera(s)
    expect(terza.esito).toBe('CREATA')

    const salvate = await righe(s)
    expect(salvate.map(r => [r.anno, r.progressivoDa, r.progressivoA])).toEqual([
      [2026, 1, 3],
      [2026, 4, 5],
      [2027, 1, 2],
    ])
    expect(salvate[1].precedenteId).toBe(salvate[0].id)
    expect(salvate[2].precedenteId).toBe(salvate[1].id)
    // L'eREGI si scarica una sola volta e si riusa.
    expect(scaricaVidimazioneXml).toHaveBeenCalledTimes(1)

    const registro = await owner.registroRifiuti.findUniqueOrThrow({ where: { id: s.registroId } })
    const esito = await verificaCatenaEsportazioni(
      registro.eregXml!,
      salvate.map(r => ({
        anno: r.anno,
        progressivoDa: r.progressivoDa,
        progressivoA: r.progressivoA,
        numeroRegistrazioni: r.numeroRegistrazioni,
        dataCreazione: r.dataCreazione,
        digestValue: r.digestValue,
        sha256File: r.sha256File,
        xml: gunzipSync(Buffer.from(r.xml)).toString('utf8'),
      }))
    )
    expect(esito).toEqual({ valida: true, errori: [] })
    const terzaXml = gunzipSync(Buffer.from(salvate[2].xml)).toString('utf8')
    expect([...terzaXml.matchAll(/<reg:Ref DigestValue="([^"]+)"/g)].map(r => r[1])).toEqual([
      DIGEST_EREGI,
      salvate[0].digestValue,
      salvate[1].digestValue,
    ])
  })

  it('il tetto di annotazioni per file spezza l intervallo e la catena prosegue dal numero successivo', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 7)
    const g = creaUseCase(3)
    const richiedi = () => g.genera(s.tenantId, s.registroId, { creataDa: null, valida: false })
    const prima = await richiedi()
    // Il tetto non e una fermata: nessun motivo, il giro successivo prosegue.
    expect(prima).toMatchObject({ esito: 'CREATA', fermataA: null })
    await richiedi()
    await richiedi()
    expect(
      (await righe(s)).map(r => [r.progressivoDa, r.progressivoA, r.numeroRegistrazioni])
    ).toEqual([
      [1, 3, 3],
      [4, 6, 3],
      [7, 7, 1],
    ])
    expect((await richiedi()).esito).toBe('NIENTE_DA_ESPORTARE')
    expect(await righe(s)).toHaveLength(3)
  })

  it('idempotente: senza annotazioni nuove restituisce l ultima, nessuna riga nuova', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
    const prima = await genera(s)
    const seconda = await genera(s)
    expect(seconda.esito).toBe('NIENTE_DA_ESPORTARE')
    if (prima.esito !== 'CREATA' || seconda.esito !== 'NIENTE_DA_ESPORTARE') return
    expect(seconda.esportazione?.id).toBe(prima.esportazione.id)
    expect(await righe(s)).toHaveLength(1)
  })

  it('registro senza annotazioni: niente da esportare, senza scaricare l eREGI', async () => {
    const s = await scenario()
    const esito = await genera(s)
    expect(esito).toMatchObject({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null })
    expect(scaricaVidimazioneXml).not.toHaveBeenCalled()
  })

  it('due richieste insieme: una sola esportazione per intervallo', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 4)
    const [a, b] = await Promise.all([genera(s), genera(s)])
    expect([a.esito, b.esito].sort()).toEqual(['CREATA', 'NIENTE_DA_ESPORTARE'])
    expect(await righe(s)).toHaveLength(1)
  })

  it('una annotazione non traducibile ferma l intervallo e dice dove', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 5)
    nonTraducibili = new Set(['2026-3'])
    const esito = await genera(s)
    expect(esito.esito).toBe('CREATA')
    if (esito.esito !== 'CREATA') return
    expect(esito.esportazione).toMatchObject({ progressivoDa: 1, progressivoA: 2 })
    expect(esito.fermataA).toEqual({
      anno: 2026,
      progressivo: 3,
      motivi: ['Dato mancante di prova'],
    })
    // Finche' resta non traducibile, il giro successivo e' bloccato su quel numero e non crea nulla.
    const ancora = await genera(s)
    expect(ancora).toEqual({
      esito: 'BLOCCATA',
      anno: 2026,
      progressivo: 3,
      motivi: ['Dato mancante di prova'],
    })
    expect(await righe(s)).toHaveLength(1)
    // Risolto il dato, l esportazione riprende da 3 e comprende anche 4 e 5.
    nonTraducibili = new Set()
    const ripresa = await genera(s)
    expect(ripresa.esito).toBe('CREATA')
    if (ripresa.esito !== 'CREATA') return
    expect(ripresa.esportazione).toMatchObject({ progressivoDa: 3, progressivoA: 5 })
  })

  it('un buco nella numerazione blocca l esportazione al numero mancante', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
    await aggiungiAnnotazioni(owner, s, 2026, 4, 5)
    const primo = await genera(s)
    expect(primo.esito === 'CREATA' && primo.esportazione.progressivoA).toBe(2)
    expect(primo.esito === 'CREATA' && primo.fermataA).toMatchObject({ progressivo: 3 })
    const secondo = await genera(s)
    expect(secondo).toMatchObject({ esito: 'BLOCCATA', anno: 2026, progressivo: 3 })
  })

  it('l autore e l utente che ha registrato, WasteFlow per le annotazioni senza utente', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 1)
    await aggiungiAnnotazioni(owner, s, 2026, 2, 2, { senzaUtente: true })
    await genera(s)
    const [riga] = await righe(s)
    const xml = gunzipSync(Buffer.from(riga.xml)).toString('utf8')
    expect(xml).toContain('<mov:Autore>Mario Rossi</mov:Autore>')
    expect(xml).toContain('<mov:Autore>WasteFlow</mov:Autore>')
  })

  it('senza certificato nessuna riga e nessuna chiamata a RENTRI per la validazione', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
    resolve.mockRejectedValue(new TenantSenzaCertificatoRentriError())
    await expect(genera(s)).rejects.toBeInstanceOf(TenantSenzaCertificatoRentriError)
    expect(await righe(s)).toHaveLength(0)
    expect(valida).not.toHaveBeenCalled()
  })

  it('dopo una esportazione rifiutata da RENTRI non se ne genera un altra', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
    await genera(s)
    await owner.esportazioneRegistroRentri.updateMany({
      where: { registroId: s.registroId },
      data: { stato: 'RIFIUTATA' },
    })
    await aggiungiAnnotazioni(owner, s, 2026, 3, 3)
    await expect(genera(s)).rejects.toBeInstanceOf(EsportazioneRifiutataInCatenaError)
    expect(await righe(s)).toHaveLength(1)
  })

  it('un rifiuto su un anello che non e l ultimo blocca la generazione', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
    await genera(s)
    await aggiungiAnnotazioni(owner, s, 2026, 3, 4)
    await genera(s)
    const [prima] = await righe(s)
    // Rifiuto tardivo (rivalida o esito in ritardo) sul primo anello, quando il secondo esiste gia'.
    await owner.esportazioneRegistroRentri.update({
      where: { id: prima.id },
      data: { stato: 'RIFIUTATA' },
    })
    await aggiungiAnnotazioni(owner, s, 2026, 5, 5)
    await expect(genera(s)).rejects.toBeInstanceOf(EsportazioneRifiutataInCatenaError)
    expect(await righe(s)).toHaveLength(2)
  })

  it('registro non collegato o con la chiusura in corso: nessun file', async () => {
    const nonCollegato = await scenario({ collegato: false })
    await aggiungiAnnotazioni(owner, nonCollegato, 2026, 1, 1)
    await expect(genera(nonCollegato)).rejects.toBeInstanceOf(RegistroNonCollegatoRentriError)

    const inChiusura = await scenario()
    await aggiungiAnnotazioni(owner, inChiusura, 2026, 1, 1)
    await owner.registroRifiuti.update({
      where: { id: inChiusura.registroId },
      data: { rentriChiusuraRichiestaIl: new Date() },
    })
    await expect(genera(inChiusura)).rejects.toBeInstanceOf(RegistroRentriChiusoError)
    expect(await righe(inChiusura)).toHaveLength(0)
  })

  it('registro chiuso su RENTRI (chiusura confermata): la generazione e ammessa, con l eREGI gia salvato', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 3)
    await genera(s)
    await aggiungiAnnotazioni(owner, s, 2026, 4, 5)
    // Chiusura confermata dall'ente: `rentriChiusoIl` valorizzato, nessuna richiesta pendente.
    await owner.registroRifiuti.update({
      where: { id: s.registroId },
      data: { rentriChiusoIl: new Date(), rentriChiusuraRichiestaIl: null },
    })
    const esito = await genera(s)
    expect(esito.esito).toBe('CREATA')
    expect((await righe(s)).map(r => [r.progressivoDa, r.progressivoA])).toEqual([
      [1, 3],
      [4, 5],
    ])
    // L'eREGI si e scaricato una volta sola, prima della chiusura: dopo si riusa la copia salvata.
    expect(scaricaVidimazioneXml).toHaveBeenCalledTimes(1)
  })

  it('un eREGI di un altro registro o illeggibile non si salva e blocca l esportazione', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 1)
    eregXml = eregiDiProva('RAAAAAAAAAA')
    await expect(genera(s)).rejects.toBeInstanceOf(EregiNonDisponibileError)
    eregXml = '<reg:eREGI xmlns:reg="urn:it:rentri:registri:1.0"/>'
    await expect(genera(s)).rejects.toBeInstanceOf(EregiNonDisponibileError)
    const registro = await owner.registroRifiuti.findUniqueOrThrow({ where: { id: s.registroId } })
    expect(registro.eregXml).toBeNull()
    expect(await righe(s)).toHaveLength(0)
  })

  it('annotazioni precedenti non incluse in nessuna esportazione: errore di coerenza, nessun file', async () => {
    const s = await scenario()
    await aggiungiAnnotazioni(owner, s, 2026, 1, 3)
    await genera(s)
    await aggiungiAnnotazioni(owner, s, 2026, 4, 5)
    // Simula un'esportazione precedente piu' corta del dovuto (riga manomessa dal proprietario).
    await owner.$executeRawUnsafe(
      `ALTER TABLE esportazioni_registro_rentri DISABLE TRIGGER esportazioni_registro_rentri_immutabile`
    )
    try {
      await owner.$executeRawUnsafe(
        `UPDATE esportazioni_registro_rentri SET numero_registrazioni = 2, progressivo_da = 2 WHERE registro_id = '${s.registroId}'`
      )
    } finally {
      await owner.$executeRawUnsafe(
        `ALTER TABLE esportazioni_registro_rentri ENABLE TRIGGER esportazioni_registro_rentri_immutabile`
      )
    }
    const errore = await genera(s).catch((e: unknown) => e)
    expect(errore).toBeInstanceOf(CatenaEsportazioniNonCoerenteError)
    // Il messaggio dice cosa fare: non e un vicolo cieco muto (rilievo 6 della review E6).
    expect((errore as Error).message).toMatch(/già esportato.*assistenza/s)
    expect(await righe(s)).toHaveLength(1)
  })

  describe('limite di data (`fino`, per l esportazione mensile)', () => {
    /** Sposta la data di annotazione delle annotazioni indicate (scritta dal proprietario). */
    async function datai(ids: string[], iso: string) {
      await owner.wasteMovement.updateMany({
        where: { id: { in: ids } },
        data: { registrationDate: new Date(iso) },
      })
    }
    const aprile = new Date('2026-04-01T00:00:00Z')
    const maggio = new Date('2026-05-01T00:00:00Z')
    const conLimite = (s: ScenarioEsportazioni, fino: Date) =>
      creaUseCase().genera(s.tenantId, s.registroId, { creataDa: null, valida: false, fino })

    it('esporta solo le annotazioni anteriori al limite e prosegue quando il limite avanza', async () => {
      const s = await scenario()
      await aggiungiAnnotazioni(owner, s, 2026, 1, 3) // marzo
      await datai(await aggiungiAnnotazioni(owner, s, 2026, 4, 5), '2026-04-10T10:00:00Z')

      const primo = await conLimite(s, aprile)
      expect(primo.esito).toBe('CREATA')
      if (primo.esito !== 'CREATA') return
      expect(primo.esportazione).toMatchObject({ progressivoDa: 1, progressivoA: 3 })

      // Stesso limite: niente di nuovo (idempotente, nessun doppione).
      const ancora = await conLimite(s, aprile)
      expect(ancora.esito).toBe('NIENTE_DA_ESPORTARE')
      expect(await righe(s)).toHaveLength(1)

      const secondo = await conLimite(s, maggio)
      expect(secondo.esito).toBe('CREATA')
      if (secondo.esito !== 'CREATA') return
      expect(secondo.esportazione).toMatchObject({ progressivoDa: 4, progressivoA: 5 })
      expect(secondo.esportazione.precedenteId).toBe(primo.esportazione.id)
    })

    it('limite precedente a tutte le annotazioni: niente da esportare, nessun file', async () => {
      const s = await scenario()
      await aggiungiAnnotazioni(owner, s, 2026, 1, 3)
      const esito = await conLimite(s, new Date('2026-03-01T00:00:00Z'))
      expect(esito.esito).toBe('NIENTE_DA_ESPORTARE')
      expect(await righe(s)).toHaveLength(0)
    })

    it('con il limite si passa all anno seguente solo per le annotazioni anteriori', async () => {
      const s = await scenario()
      await aggiungiAnnotazioni(owner, s, 2026, 1, 2)
      await datai(await aggiungiAnnotazioni(owner, s, 2027, 1, 2), '2027-02-10T10:00:00Z')
      expect((await conLimite(s, new Date('2027-01-01T00:00:00Z'))).esito).toBe('CREATA')
      expect((await conLimite(s, new Date('2027-01-01T00:00:00Z'))).esito).toBe('NIENTE_DA_ESPORTARE')
      const dopo = await conLimite(s, new Date('2027-03-01T00:00:00Z'))
      expect(dopo.esito).toBe('CREATA')
      if (dopo.esito !== 'CREATA') return
      expect(dopo.esportazione).toMatchObject({ anno: 2027, progressivoDa: 1, progressivoA: 2 })
    })
  })

  it('con il contesto di un altra azienda non si genera ne si vede nulla del registro', async () => {
    const a = await scenario()
    const b = await scenario()
    await aggiungiAnnotazioni(owner, a, 2026, 1, 2)
    await expect(
      creaUseCase().genera(b.tenantId, a.registroId, { creataDa: null, valida: false })
    ).rejects.toThrow()
    expect(await righe(a)).toHaveLength(0)
  })
})
