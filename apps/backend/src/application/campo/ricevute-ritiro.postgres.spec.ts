/**
 * App campo P6 contro un Postgres reale, collegato COME `wasteflow_app`: registrazione delle
 * ricevute di ritiro (idempotenza, ritiro dell'autista, tetto, PDF archiviato con impronta), invio
 * facoltativo al cliente ed elenco/scarico d'ufficio. Lo schema e' in `ricevute-ritiro.schema.postgres.spec.ts`.
 */
import { createHash } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import type { EmailService } from '../../infrastructure/email/email.service'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import {
  creaAziendaCampo,
  creaRitiroCampo,
  type AziendaCampo,
} from '../../test-support/campo-di-test'
import { pngDiProva } from '../../test-support/png-di-prova'
import { RitiroDatiNonValidiError, RitiroNonTrovatoError } from '../ritiri/errori-ritiri'
import {
  AutistaNonCollegatoError,
  RicevutaDiAltroUtenteError,
  RicevutaLimiteRitiroError,
  RicevutaNonConsentitaError,
  RicevutaNonTrovataError,
} from './errori-campo'
import {
  RICEVUTE_MASSIME_PER_RITIRO,
  RicevuteRitiroService,
  VARIABILE_INVIO_EMAIL_RICEVUTE,
} from './ricevute-ritiro.service'

describe('Ricevute di ritiro P6 — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: RicevuteRitiroService
  const invia = jest.fn<Promise<void>, [Record<string, unknown>]>()
  const posta = { modalitaSviluppo: false, sendEmail: invia } as unknown as EmailService
  const creati: string[] = []
  const envOriginale = process.env[VARIABILE_INVIO_EMAIL_RICEVUTE]

  const azienda = async (): Promise<AziendaCampo> => {
    const a = await creaAziendaCampo(owner)
    creati.push(a.t)
    return a
  }
  const nelTenant = <R>(t: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  const ricevuta = (ritiroId: string, extra: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID() as string,
    ritiroId,
    firmatarioNome: 'Mario Rossi',
    firmatoIl: '2026-12-01T08:30:00.000Z',
    firmaPng: pngDiProva().toString('base64'),
    emailCliente: undefined as unknown,
    ...extra,
  })
  const registra = (a: AziendaCampo, utente: string, r: ReturnType<typeof ricevuta>) =>
    nelTenant(a.t, () => servizio.registra(a.t, utente, r))
  const righe = (a: AziendaCampo) =>
    owner.ricevutaRitiro.findMany({ where: { tenantId: a.t }, orderBy: { ricevutoIl: 'asc' } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new RicevuteRitiroService(app, new RitiriRepository(), posta)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  beforeEach(() => {
    invia.mockReset()
    invia.mockResolvedValue(undefined)
    delete process.env[VARIABILE_INVIO_EMAIL_RICEVUTE]
  })

  afterAll(async () => {
    if (envOriginale === undefined) delete process.env[VARIABILE_INVIO_EMAIL_RICEVUTE]
    else process.env[VARIABILE_INVIO_EMAIL_RICEVUTE] = envOriginale
    for (const t of creati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia ricevute: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('archivia la ricevuta: PDF vero, impronte coerenti, dati del ritiro letti dal server', async () => {
    const a = await azienda()
    const rit = await creaRitiroCampo(owner, a, a.autista1)
    const r = ricevuta(rit)
    const risp = await registra(a, a.utente1, r)
    expect(risp).toMatchObject({ id: r.id, invio: 'NON_RICHIESTO' })
    expect(risp.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
    const [riga] = await righe(a)
    expect(riga.firmatarioNome).toBe('Mario Rossi')
    expect(riga.autistaId).toBe(a.autista1)
    expect(riga.utenteId).toBe(a.utente1)
    expect(Buffer.from(riga.pdf).subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(createHash('sha256').update(riga.pdf).digest('hex')).toBe(riga.pdfSha256)
    expect(createHash('sha256').update(riga.firmaPng).digest('hex')).toBe(riga.firmaSha256)
    expect(riga.pdfSha256).toBe(risp.pdfSha256)
    expect(riga.contenutoSha256).toBe(risp.contenutoSha256)
    expect(riga.dati).toMatchObject({
      azienda: 'Campo SRL',
      cerCode: '200301',
      descrizione: 'Rifiuti urbani non differenziati',
      quantitaPresunta: '100.00',
      unita: 'KG',
      dataRitiro: '2026-12-01',
    })
  })

  it('i dati stampati vengono dal database, non dal corpo: un campo in piu non e ammesso', async () => {
    const a = await azienda()
    const rit = await creaRitiroCampo(owner, a, a.autista1)
    // Il servizio ignora qualunque campo estraneo (la whitelist del DTO lo rifiuta prima in HTTP).
    const r = { ...ricevuta(rit), cliente: 'Altro SRL', cerCode: '999999' }
    await registra(a, a.utente1, r)
    const [riga] = await righe(a)
    expect(riga.dati).toMatchObject({ cerCode: '200301' })
    expect(JSON.stringify(riga.dati)).not.toContain('Altro SRL')
  })

  it('idempotenza: lo stesso uuid risponde uguale e non duplica', async () => {
    const a = await azienda()
    const rit = await creaRitiroCampo(owner, a, a.autista1)
    const r = ricevuta(rit)
    const prima = await registra(a, a.utente1, r)
    const seconda = await registra(a, a.utente1, r)
    expect(seconda).toEqual(prima)
    expect(await righe(a)).toHaveLength(1)
  })

  it('5 richieste concorrenti con lo stesso uuid: una riga sola, stessa risposta a tutte', async () => {
    const a = await azienda()
    const rit = await creaRitiroCampo(owner, a, a.autista1)
    const r = ricevuta(rit)
    const risp = await Promise.all(Array.from({ length: 5 }, () => registra(a, a.utente1, r)))
    expect(await righe(a)).toHaveLength(1)
    for (const x of risp) expect(x.pdfSha256).toBe(risp[0].pdfSha256)
  })

  it('lo stesso uuid da un altro autista: 409 e nessuna riga in piu', async () => {
    const a = await azienda()
    const r1 = await creaRitiroCampo(owner, a, a.autista1)
    const r2 = await creaRitiroCampo(owner, a, a.autista2)
    const r = ricevuta(r1)
    await registra(a, a.utente1, r)
    await expect(registra(a, a.utente2, { ...r, ritiroId: r2 })).rejects.toBeInstanceOf(
      RicevutaDiAltroUtenteError
    )
    expect(await righe(a)).toHaveLength(1)
  })

  it('ritiro di un altro autista, senza autista, non piu da fare: rifiutata e non scritta', async () => {
    const a = await azienda()
    const altrui = await creaRitiroCampo(owner, a, a.autista2)
    const libero = await creaRitiroCampo(owner, a, null)
    await expect(registra(a, a.utente1, ricevuta(altrui))).rejects.toBeInstanceOf(
      RicevutaNonConsentitaError
    )
    await expect(registra(a, a.utente1, ricevuta(libero))).rejects.toBeInstanceOf(
      RicevutaNonConsentitaError
    )
    const annullato = await creaRitiroCampo(owner, a, a.autista1)
    await owner.ritiro.update({
      where: { id: annullato },
      data: { stato: 'ANNULLATO', motivo: 'Annullato in ufficio' },
    })
    const nonEseguito = await creaRitiroCampo(owner, a, a.autista1)
    await owner.ritiro.update({
      where: { id: nonEseguito },
      data: { stato: 'NON_ESEGUITO', motivo: 'Cliente assente' },
    })
    await expect(registra(a, a.utente1, ricevuta(annullato))).rejects.toBeInstanceOf(
      RicevutaNonConsentitaError
    )
    await expect(registra(a, a.utente1, ricevuta(nonEseguito))).rejects.toBeInstanceOf(
      RicevutaNonConsentitaError
    )
    expect(await righe(a)).toHaveLength(0)
  })

  it('ritiro di un’altra azienda o inesistente: 404, utente non autista: 403, corpo non valido: 400', async () => {
    const a = await azienda()
    const b = await azienda()
    const rb = await creaRitiroCampo(owner, b, b.autista1)
    await expect(registra(a, a.utente1, ricevuta(rb))).rejects.toBeInstanceOf(RitiroNonTrovatoError)
    await expect(registra(a, a.utente1, ricevuta(crypto.randomUUID()))).rejects.toBeInstanceOf(
      RitiroNonTrovatoError
    )
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    await expect(registra(a, a.admin, ricevuta(ra))).rejects.toBeInstanceOf(
      AutistaNonCollegatoError
    )
    await expect(registra(a, a.utente1, ricevuta(ra, { firmaPng: 'AAAA' }))).rejects.toBeInstanceOf(
      RitiroDatiNonValidiError
    )
    expect(await righe(a)).toHaveLength(0)
    expect(await righe(b)).toHaveLength(0)
  })

  it('un autista disattivato non puo piu registrare ricevute', async () => {
    const a = await azienda()
    const rit = await creaRitiroCampo(owner, a, a.autista1)
    await owner.autista.update({ where: { id: a.autista1 }, data: { attivo: false } })
    await expect(registra(a, a.utente1, ricevuta(rit))).rejects.toBeInstanceOf(
      AutistaNonCollegatoError
    )
  })

  it(`al massimo ${RICEVUTE_MASSIME_PER_RITIRO} ricevute per ritiro, anche con richieste parallele`, async () => {
    const a = await azienda()
    const rit = await creaRitiroCampo(owner, a, a.autista1)
    const esiti = await Promise.allSettled(
      Array.from({ length: RICEVUTE_MASSIME_PER_RITIRO + 3 }, () =>
        registra(a, a.utente1, ricevuta(rit))
      )
    )
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(RICEVUTE_MASSIME_PER_RITIRO)
    const rifiutate = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
    expect(rifiutate).toHaveLength(3)
    for (const x of rifiutate) expect(x.reason).toBeInstanceOf(RicevutaLimiteRitiroError)
    expect(await righe(a)).toHaveLength(RICEVUTE_MASSIME_PER_RITIRO)
  })

  describe('invio facoltativo al cliente', () => {
    it('spento per default: l’email e ignorata, nulla viene spedito ne conservato', async () => {
      const a = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      expect(servizio.configurazione()).toEqual({ invioEmail: false })
      const risp = await registra(a, a.utente1, ricevuta(rit, { emailCliente: 'c@esempio.it' }))
      expect(risp.invio).toBe('NON_ABILITATO')
      expect(invia).not.toHaveBeenCalled()
      expect(await owner.invioRicevutaRitiro.count({ where: { tenantId: a.t } })).toBe(0)
    })

    it('acceso: spedisce il PDF archiviato, conserva solo l’indirizzo mascherato, niente dati nel log', async () => {
      process.env[VARIABILE_INVIO_EMAIL_RICEVUTE] = 'true'
      const a = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      expect(servizio.configurazione()).toEqual({ invioEmail: true })
      const risp = await registra(
        a,
        a.utente1,
        ricevuta(rit, { emailCliente: 'Mario.Rossi@Cliente.it' })
      )
      expect(risp.invio).toBe('INVIATO')
      expect(invia).toHaveBeenCalledTimes(1)
      const chiamata = invia.mock.calls[0][0] as {
        to: string
        senzaDatiNeiLog: boolean
        attachments: { content: Buffer; filename: string }[]
      }
      expect(chiamata.to).toBe('mario.rossi@cliente.it')
      expect(chiamata.senzaDatiNeiLog).toBe(true)
      const [riga] = await righe(a)
      expect(createHash('sha256').update(chiamata.attachments[0].content).digest('hex')).toBe(
        riga.pdfSha256
      )
      expect(chiamata.attachments[0].filename).toBe('ricevuta-ritiro-2026-12-01.pdf')
      const invio = await owner.invioRicevutaRitiro.findFirstOrThrow({ where: { tenantId: a.t } })
      expect(invio).toMatchObject({ esito: 'INVIATO', destinatarioMascherato: 'm***@cliente.it' })
      expect(JSON.stringify(invio)).not.toContain('Rossi')
      // Il reinvio della stessa ricevuta non rispedisce e riporta l'esito.
      const dopo = await registra(
        a,
        a.utente1,
        ricevuta(rit, { id: riga.ricevutaUuid, emailCliente: 'altro@cliente.it' })
      )
      expect(dopo.invio).toBe('INVIATO')
      expect(invia).toHaveBeenCalledTimes(1)
    })

    it('posta in errore: la ricevuta resta archiviata e l’esito e FALLITO', async () => {
      process.env[VARIABILE_INVIO_EMAIL_RICEVUTE] = 'true'
      invia.mockRejectedValue(new Error('SMTP giu per c@esempio.it'))
      const a = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      const risp = await registra(a, a.utente1, ricevuta(rit, { emailCliente: 'c@esempio.it' }))
      expect(risp.invio).toBe('FALLITO')
      expect(await righe(a)).toHaveLength(1)
      const invio = await owner.invioRicevutaRitiro.findFirstOrThrow({ where: { tenantId: a.t } })
      expect(invio).toMatchObject({ esito: 'FALLITO', destinatarioMascherato: 'c***@esempio.it' })
    })

    it('senza email richiesta: NON_RICHIESTO anche con l’invio acceso', async () => {
      process.env[VARIABILE_INVIO_EMAIL_RICEVUTE] = 'true'
      const a = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      const risp = await registra(a, a.utente1, ricevuta(rit))
      expect(risp.invio).toBe('NON_RICHIESTO')
      expect(invia).not.toHaveBeenCalled()
    })

    it('servizio posta in modalita sviluppo: l’invio non e offerto e non si dichiara inviato', async () => {
      process.env[VARIABILE_INVIO_EMAIL_RICEVUTE] = 'true'
      const sviluppo = new RicevuteRitiroService(app, new RitiriRepository(), {
        modalitaSviluppo: true,
        sendEmail: invia,
      } as unknown as EmailService)
      expect(sviluppo.configurazione()).toEqual({ invioEmail: false })
      const a = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      const risp = await nelTenant(a.t, () =>
        sviluppo.registra(a.t, a.utente1, ricevuta(rit, { emailCliente: 'c@esempio.it' }))
      )
      expect(risp.invio).toBe('NON_ABILITATO')
      expect(invia).not.toHaveBeenCalled()
    })
  })

  describe('ufficio: elenco e scarico', () => {
    it('elenca dalla piu recente senza byte, con filtro per ritiro e isolamento fra aziende', async () => {
      const a = await azienda()
      const b = await azienda()
      const r1 = await creaRitiroCampo(owner, a, a.autista1)
      const r2 = await creaRitiroCampo(owner, a, a.autista1)
      const rb = await creaRitiroCampo(owner, b, b.autista1)
      await registra(a, a.utente1, ricevuta(r1))
      await registra(a, a.utente1, ricevuta(r2, { firmatarioNome: 'Anna Verdi' }))
      await registra(b, b.utente1, ricevuta(rb))
      const elenco = await nelTenant(a.t, () => servizio.elenca(a.t, {}))
      expect(elenco.totale).toBe(2)
      expect(elenco.righe.map(x => x.firmatarioNome)).toEqual(['Anna Verdi', 'Mario Rossi'])
      const x = elenco.righe[0]
      expect(x).toMatchObject({
        ritiroId: r2,
        cliente: expect.any(String),
        cerCode: '200301',
        dataRitiro: '2026-12-01',
        autista: 'Prova Uno',
        invio: null,
      })
      expect(x.dimensionePdf).toBeGreaterThan(1000)
      expect(JSON.stringify(elenco)).not.toMatch(/"pdf"|firmaPng|firma_png/)
      const filtrato = await nelTenant(a.t, () => servizio.elenca(a.t, { ritiroId: r1 }))
      expect(filtrato.righe.map(y => y.ritiroId)).toEqual([r1])
    })

    it('scarica i byte archiviati; un’altra azienda non li vede', async () => {
      const a = await azienda()
      const b = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      const risp = await registra(a, a.utente1, ricevuta(rit))
      const [riga] = await righe(a)
      const pdf = await nelTenant(a.t, () => servizio.leggiPdf(a.t, riga.id))
      expect(pdf.contenuto.subarray(0, 5).toString('ascii')).toBe('%PDF-')
      expect(createHash('sha256').update(pdf.contenuto).digest('hex')).toBe(risp.pdfSha256)
      expect(pdf.nomeFile).toBe('ricevuta-ritiro-2026-12-01.pdf')
      await expect(nelTenant(b.t, () => servizio.leggiPdf(b.t, riga.id))).rejects.toBeInstanceOf(
        RicevutaNonTrovataError
      )
      await expect(
        nelTenant(a.t, () => servizio.leggiPdf(a.t, crypto.randomUUID()))
      ).rejects.toBeInstanceOf(RicevutaNonTrovataError)
    })

    it('se i byte archiviati non corrispondono all’impronta, non si consegnano', async () => {
      const a = await azienda()
      const rit = await creaRitiroCampo(owner, a, a.autista1)
      await registra(a, a.utente1, ricevuta(rit))
      const [riga] = await righe(a)
      await owner.$executeRawUnsafe(
        `ALTER TABLE ricevute_ritiro DISABLE TRIGGER ricevute_ritiro_no_update`
      )
      try {
        await owner.$executeRawUnsafe(
          `UPDATE ricevute_ritiro SET pdf_sha256 = '${'0'.repeat(64)}' WHERE id = '${riga.id}'`
        )
        await expect(nelTenant(a.t, () => servizio.leggiPdf(a.t, riga.id))).rejects.toThrow(
          /impronta del PDF non corrispondente/
        )
      } finally {
        await owner.$executeRawUnsafe(
          `ALTER TABLE ricevute_ritiro ENABLE TRIGGER ricevute_ritiro_no_update`
        )
      }
    })
  })
})
