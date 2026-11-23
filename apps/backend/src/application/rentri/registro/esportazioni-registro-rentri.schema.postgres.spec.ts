/**
 * Schema delle esportazioni XML del registro (eREGI E6, migration M2) contro un Postgres reale,
 * COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext`. Il proprietario (`wasteflow`)
 * prepara aziende e registri e legge cio' che e' stato scritto; la pulizia toglie solo le aziende
 * create qui, per id esatti.
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

import { createHash, randomUUID } from 'crypto'
import { gzipSync } from 'zlib'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'

describe('Esportazioni XML del registro RENTRI, schema — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  type Az = { tenantId: string; registroId: string }

  async function azienda(): Promise<Az> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Esportazioni RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001ES${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, unitaLocaleId: sede.id, descrizione: 'Registro di prova' },
    })
    return { tenantId: t.id, registroId: registro.id }
  }

  const sha = (testo: string) => createHash('sha256').update(testo).digest('hex')
  const DIGEST = Buffer.alloc(32, 7).toString('base64')

  /** Dati validi di un'esportazione; `extra` sovrascrive. */
  function dati(az: Az, extra: Record<string, unknown> = {}) {
    return {
      tenantId: az.tenantId,
      registroId: az.registroId,
      anno: 2026,
      progressivoDa: 1,
      progressivoA: 3,
      numeroRegistrazioni: 3,
      dataCreazione: new Date('2026-03-31T10:00:00Z'),
      digestValue: DIGEST,
      sha256File: sha('xml'),
      xml: gzipSync(Buffer.from('<reg:Registro/>')),
      firmato: true,
      certificatoSha256: sha('cert'),
      creataDa: randomUUID(),
      ...extra,
    }
  }

  /** L'errore porta il nome del vincolo (o il messaggio del trigger). */
  async function errore(p: Promise<unknown>): Promise<string> {
    try {
      await p
    } catch (e) {
      return String((e as Error).message)
    }
    throw new Error('attesa una violazione, non e arrivata')
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it("inserisce e rilegge un'esportazione nel contesto dell'azienda, con i valori predefiniti", async () => {
    const az = await azienda()
    const creata = await nelTenant(az.tenantId, () =>
      app.db.esportazioneRegistroRentri.create({ data: dati(az) })
    )
    expect(creata.stato).toBe('GENERATA')
    expect(creata.messaggi).toEqual([])
    expect(creata.precedenteId).toBeNull()
    expect(creata.transazioneValidazioneId).toBeNull()
    const letta = await nelTenant(az.tenantId, () =>
      app.db.esportazioneRegistroRentri.findUnique({ where: { id: creata.id } })
    )
    expect(Buffer.from(letta!.xml).length).toBeGreaterThan(0)
    expect(letta!.digestValue).toBe(DIGEST)
  })

  it('con il contesto di B le righe di A non si vedono, non si aggiornano e non si scrivono', async () => {
    const a = await azienda()
    const b = await azienda()
    const r = await owner.esportazioneRegistroRentri.create({ data: dati(a) })
    expect(
      await nelTenant(b.tenantId, () =>
        app.db.esportazioneRegistroRentri.findMany({ where: { id: r.id } })
      )
    ).toHaveLength(0)
    const upd = await nelTenant(b.tenantId, () =>
      app.db.esportazioneRegistroRentri.updateMany({
        where: { id: r.id },
        data: { stato: 'VALIDATA' },
      })
    )
    expect(upd.count).toBe(0)
    await expect(
      nelTenant(b.tenantId, () => app.db.esportazioneRegistroRentri.create({ data: dati(a) }))
    ).rejects.toThrow(/row-level security|violates/i)
  })

  describe('CHECK', () => {
    const casi: Array<[string, string, Record<string, unknown>]> = [
      [
        'progressivi_check',
        'da maggiore di a',
        { progressivoDa: 5, progressivoA: 3, numeroRegistrazioni: -1 },
      ],
      ['numero_check', 'numero_registrazioni diverso da a - da + 1', { numeroRegistrazioni: 2 }],
      ['firmato_check', 'firmato senza digest', { digestValue: null }],
      ['firmato_check', 'digest senza firmato', { firmato: false }],
      ['certificato_check', 'firmato senza impronta del certificato', { certificatoSha256: null }],
      ['sha256_check', 'sha256 del file non esadecimale', { sha256File: 'z'.repeat(64) }],
      ['anno_check', 'anno fuori intervallo', { anno: 1999 }],
    ]
    for (const [nome, descrizione, extra] of casi) {
      it(`${nome}: ${descrizione}`, async () => {
        const az = await azienda()
        const msg = await errore(owner.esportazioneRegistroRentri.create({ data: dati(az, extra) }))
        expect(msg).toContain(`esportazioni_registro_rentri_${nome}`)
      })
    }

    it('una esportazione non firmata (senza digest ne certificato) e ammessa dallo schema', async () => {
      const az = await azienda()
      const r = await owner.esportazioneRegistroRentri.create({
        data: dati(az, { digestValue: null, firmato: false, certificatoSha256: null }),
      })
      expect(r.firmato).toBe(false)
    })
  })

  it('stessa (registro, anno, progressivo_a) due volte: violazione; altro anno consentito', async () => {
    const az = await azienda()
    const prima = await owner.esportazioneRegistroRentri.create({ data: dati(az) })
    const msg = await errore(
      owner.esportazioneRegistroRentri.create({ data: dati(az, { sha256File: sha('altro') }) })
    )
    expect(msg).toMatch(/Unique constraint|esportazioni_registro_rentri_registro_anno_a_key/)
    await expect(
      owner.esportazioneRegistroRentri.create({
        data: dati(az, { anno: 2027, precedenteId: prima.id }),
      })
    ).resolves.toBeDefined()
  })

  describe('catena', () => {
    it('una sola successiva per esportazione e una sola prima per registro', async () => {
      const az = await azienda()
      const prima = await owner.esportazioneRegistroRentri.create({ data: dati(az) })
      const seconda = await owner.esportazioneRegistroRentri.create({
        data: dati(az, {
          progressivoDa: 4,
          progressivoA: 5,
          numeroRegistrazioni: 2,
          precedenteId: prima.id,
          digestValue: Buffer.alloc(32, 8).toString('base64'),
        }),
      })
      const doppiaSuccessiva = await errore(
        owner.esportazioneRegistroRentri.create({
          data: dati(az, {
            progressivoDa: 4,
            progressivoA: 6,
            numeroRegistrazioni: 3,
            precedenteId: prima.id,
          }),
        })
      )
      expect(doppiaSuccessiva).toMatch(/Unique constraint|esportazioni_registro_rentri_precedente/)
      const secondaPrima = await errore(
        owner.esportazioneRegistroRentri.create({
          data: dati(az, { anno: 2027, progressivoA: 9, progressivoDa: 7, numeroRegistrazioni: 3 }),
        })
      )
      expect(secondaPrima).toMatch(/Unique constraint|esportazioni_registro_rentri_prima_key/)
      expect(seconda.precedenteId).toBe(prima.id)
    })

    it('la precedente deve essere dello stesso registro e della stessa azienda', async () => {
      const a = await azienda()
      const b = await azienda()
      const rA = await owner.esportazioneRegistroRentri.create({ data: dati(a) })
      const msg = await errore(
        owner.esportazioneRegistroRentri.create({
          data: dati(b, {
            precedenteId: rA.id,
            progressivoDa: 4,
            progressivoA: 4,
            numeroRegistrazioni: 1,
          }),
        })
      )
      expect(msg).toMatch(/esportazioni_registro_rentri_precedente_fkey|Foreign key/)
    })
  })

  describe('trigger di immutabilita', () => {
    const modifiche: Array<[string, Record<string, unknown>]> = [
      ['id', { id: randomUUID() }],
      ['xml', { xml: gzipSync(Buffer.from('<altro/>')) }],
      ['digest_value', { digestValue: Buffer.alloc(32, 9).toString('base64') }],
      ['sha256_file', { sha256File: sha('altro') }],
      ['data_creazione', { dataCreazione: new Date('2027-01-01T00:00:00Z') }],
      ['progressivo_da', { progressivoDa: 2, numeroRegistrazioni: 2 }],
      ['progressivo_a', { progressivoA: 4, numeroRegistrazioni: 4 }],
      ['anno', { anno: 2027 }],
      ['firmato', { firmato: false, digestValue: null, certificatoSha256: null }],
      ['certificato_sha256', { certificatoSha256: sha('altro') }],
      ['creata_da', { creataDa: randomUUID() }],
    ]
    for (const [colonna, extra] of modifiche) {
      it(`${colonna} non si modifica`, async () => {
        const az = await azienda()
        const r = await owner.esportazioneRegistroRentri.create({ data: dati(az) })
        const msg = await errore(
          owner.esportazioneRegistroRentri.update({ where: { id: r.id }, data: extra as never })
        )
        expect(msg).toContain('esportazioni_registro_rentri: dato immutabile')
      })
    }

    it('precedente_id, registro e azienda non si modificano', async () => {
      const az = await azienda()
      const altro = await azienda()
      const r = await owner.esportazioneRegistroRentri.create({ data: dati(az) })
      const msg = await errore(
        owner.$executeRawUnsafe(
          `UPDATE esportazioni_registro_rentri SET registro_id = '${altro.registroId}', tenant_id = '${altro.tenantId}' WHERE id = '${r.id}'`
        )
      )
      expect(msg).toMatch(/dato immutabile|violates/)
    })

    it('stato, transazione, messaggi e updated_at cambiano', async () => {
      const az = await azienda()
      const r = await nelTenant(az.tenantId, () =>
        app.db.esportazioneRegistroRentri.create({ data: dati(az) })
      )
      const transazione = randomUUID()
      const dopo = await nelTenant(az.tenantId, () =>
        app.db.esportazioneRegistroRentri.update({
          where: { id: r.id },
          data: {
            stato: 'VALIDATA_CON_AVVISI',
            transazioneValidazioneId: transazione,
            messaggi: [{ codice: 'x', tipo: 'Avvertimento', campo: null }],
          },
        })
      )
      expect(dopo.stato).toBe('VALIDATA_CON_AVVISI')
      expect(dopo.transazioneValidazioneId).toBe(transazione)
      expect(dopo.updatedAt.getTime()).toBeGreaterThanOrEqual(r.updatedAt.getTime())
    })

    it('DELETE diretto rifiutato; la cascata di cancellazione dell azienda passa', async () => {
      const az = await azienda()
      const r = await owner.esportazioneRegistroRentri.create({ data: dati(az) })
      const msg = await errore(owner.esportazioneRegistroRentri.delete({ where: { id: r.id } }))
      expect(msg).toContain('esportazioni_registro_rentri: non si cancella')
      await cancellaAziendeDiProva(owner, az.tenantId)
      expect(await owner.esportazioneRegistroRentri.count({ where: { id: r.id } })).toBe(0)
    })
  })

  describe('eREGI sul registro', () => {
    const ereg = {
      eregXml: '<reg:eREGI/>',
      eregDigest: Buffer.alloc(32, 1).toString('base64'),
      eregDataRichiesta: new Date('2026-01-05T09:00:00Z'),
      eregScaricatoIl: new Date('2026-01-05T09:00:01Z'),
    }

    it('le quattro colonne vanno insieme: tutte o nessuna', async () => {
      const az = await azienda()
      const msg = await errore(
        owner.registroRifiuti.update({
          where: { id: az.registroId },
          data: { eregXml: '<reg:eREGI/>' },
        })
      )
      expect(msg).toContain('registri_rifiuti_ereg_completo_check')
      const ok = await owner.registroRifiuti.update({ where: { id: az.registroId }, data: ereg })
      expect(ok.eregDigest).toBe(ereg.eregDigest)
    })

    it("con almeno un'esportazione l'eREGI non cambia piu; senza si puo ri-scaricare", async () => {
      const az = await azienda()
      await owner.registroRifiuti.update({ where: { id: az.registroId }, data: ereg })
      // Senza esportazioni: ri-scaricabile.
      await owner.registroRifiuti.update({
        where: { id: az.registroId },
        data: { eregDigest: Buffer.alloc(32, 2).toString('base64') },
      })
      await owner.esportazioneRegistroRentri.create({ data: dati(az) })
      const msg = await errore(
        owner.registroRifiuti.update({
          where: { id: az.registroId },
          data: { eregDigest: Buffer.alloc(32, 3).toString('base64') },
        })
      )
      expect(msg).toContain('registri_rifiuti: eREGI immutabile')
      // Riscrivere lo stesso valore (un nuovo download identico) e innocuo; altre colonne non toccano la regola.
      await owner.registroRifiuti.update({
        where: { id: az.registroId },
        data: { descrizione: 'Registro rinominato' },
      })
    })
  })
})
