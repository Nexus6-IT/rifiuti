/**
 * Accodamento dell'invio allo SDI (4.5b, T1) contro un Postgres reale, COME `wasteflow_app` (RLS FORCE).
 * I documenti sono DEFINITIVI veri (anteprima + definitiva). Il proprietario prepara le configurazioni
 * e legge lo stato finale. Pulizia solo per id esatti.
 */
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `sdi-b-invio-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import { ProviderSdiFake } from '../../infrastructure/sdi/fake/provider-sdi-fake'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import { esitoHttp as esito } from '../../test-support/fatturazione-t19-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { DocumentiFatturaService } from '../fatturazione/documenti-fattura.service'
import { RegistroProviderSdi } from '../fatturazione/sdi/registro-provider-sdi'
import { XmlDocumentoService } from '../fatturazione/xml-documento.service'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import { InvioSdiService, TETTO_DOCUMENTI_INVIO_SDI } from './invio-sdi.service'

describe('InvioSdiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  let configurazione: ConfigurazioneSdiService
  let xml: XmlDocumentoService
  let servizio: InvioSdiService
  const tenantCreati: string[] = []
  const invii = process.env.SDI_INVII_ATTIVI

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    process.env.SDI_INVII_ATTIVI = 'true'
    b.reset()
    const registro = new RegistroProviderSdi([new ProviderSdiFake()])
    configurazione = new ConfigurazioneSdiService(
      app,
      { get: () => 'chiave-di-cifratura-di-prova' } as unknown as ConfigService,
      registro
    )
    xml = new XmlDocumentoService(app, new DocumentiFatturaService(app))
    servizio = new InvioSdiService(app, configurazione, registro, xml)
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    if (invii === undefined) delete process.env.SDI_INVII_ATTIVI
    else process.env.SDI_INVII_ATTIVI = invii
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  /** Azienda con configurazione `fake` verificata e invio acceso (a meno di `attiva: false`). */
  async function aziendaSdi(
    o: { configura?: boolean; attiva?: boolean } = {}
  ): Promise<AziendaT18> {
    const az = await b.t19.azienda()
    if (o.configura === false) return az
    const c = await configurazione.imposta(az.tenantId, az.utenteId, {
      provider: 'fake',
      ambiente: 'SANDBOX',
      versione: 0,
    })
    const v = await configurazione.verifica(az.tenantId, az.utenteId)
    expect(v.esito.ok).toBe(true)
    if (o.attiva !== false) {
      await configurazione.impostaInvioAttivo(az.tenantId, az.utenteId, {
        attivo: true,
        versione: v.configurazione.versione,
      })
    }
    expect(c.configurata).toBe(true)
    return az
  }

  const trasmissioni = (tenantId: string) =>
    owner.$queryRawUnsafe<
      {
        id: string
        documento_id: string
        stato: string
        nome_file: string
        xml_sha256: string
        provider: string
        ambiente: string
        richiesta_da: string | null
      }[]
    >(
      `SELECT id::text, documento_id::text, stato::text, nome_file, xml_sha256, provider, ambiente,
              richiesta_da::text FROM trasmissioni_sdi WHERE tenant_id = $1::uuid ORDER BY created_at`,
      tenantId
    )

  async function documentoRiga(id: string) {
    const [r] = await owner.$queryRawUnsafe<
      { emesso_il: Date | null; xml_sha256: string | null; progressivo_file: string | null }[]
    >(
      `SELECT emesso_il, xml_sha256, progressivo_file FROM documenti_fattura WHERE id = $1::uuid`,
      id
    )
    return r
  }

  const accoda = (az: AziendaT18, ids: string[], confermaGiaEmesso?: boolean) =>
    servizio.accoda(az.tenantId, az.utenteId, { ids, confermaGiaEmesso })

  it('un documento definitivo: una trasmissione DA_INVIARE con nome file e impronta dell XML, documento emesso', async () => {
    const az = await aziendaSdi()
    const [d] = await b.definitivi(az, 1)
    const r = await accoda(az, [d.id])
    expect(r.saltate).toEqual([])
    expect(r.accodate).toHaveLength(1)
    expect(r.accodate[0].documentoId).toBe(d.id)
    const righe = await trasmissioni(az.tenantId)
    expect(righe).toHaveLength(1)
    const doc = await documentoRiga(d.id)
    expect(doc.emesso_il).not.toBeNull()
    expect(righe[0]).toMatchObject({
      id: r.accodate[0].trasmissioneId,
      stato: 'DA_INVIARE',
      provider: 'fake',
      ambiente: 'SANDBOX',
      xml_sha256: doc.xml_sha256,
      nome_file: expect.stringMatching(/^IT\d{11}_00001\.xml$/),
      richiesta_da: az.utenteId,
    })
    const audit = await owner.activityLog.count({
      where: { tenantId: az.tenantId, action: 'SDI_TRASMISSIONE_ACCODATA' },
    })
    expect(audit).toBe(1)
  }, 90_000)

  it('due richieste parallele sullo stesso documento: UNA trasmissione, l altra torna fra le saltate', async () => {
    const az = await aziendaSdi()
    const [d] = await b.definitivi(az, 1)
    const [x, y] = await Promise.all([accoda(az, [d.id], true), accoda(az, [d.id], true)])
    expect(x.accodate.length + y.accodate.length).toBe(1)
    const saltate = [...x.saltate, ...y.saltate]
    expect(saltate).toHaveLength(1)
    expect(saltate[0].motivo).toBe('TRASMISSIONE_IN_CORSO')
    expect(await trasmissioni(az.tenantId)).toHaveLength(1)
  }, 90_000)

  it('un documento con una trasmissione viva e saltato TRASMISSIONE_IN_CORSO; dopo ERRORE_INVIO si puo accodare di nuovo', async () => {
    const az = await aziendaSdi()
    const [d] = await b.definitivi(az, 1)
    await accoda(az, [d.id])
    const seconda = await accoda(az, [d.id], true)
    expect(seconda.saltate).toEqual([{ documentoId: d.id, motivo: 'TRASMISSIONE_IN_CORSO' }])
    expect(await trasmissioni(az.tenantId)).toHaveLength(1)
  }, 90_000)

  it('BOZZA e ANNULLATO sono saltati NON_DEFINITIVO, un id sconosciuto NON_TROVATO', async () => {
    const az = await aziendaSdi()
    await b.t19.contratto(az)
    const e = await b.t19.pronta(az)
    const [bozza] = await b.t19.documenti(e.id)
    expect(bozza.stato).toBe('BOZZA')
    const r = await accoda(az, [bozza.id, '00000000-0000-4000-8000-000000000000'])
    expect(r.accodate).toEqual([])
    expect(r.saltate).toEqual([
      { documentoId: bozza.id, motivo: 'NON_DEFINITIVO' },
      { documentoId: '00000000-0000-4000-8000-000000000000', motivo: 'NON_TROVATO' },
    ])

    const az2 = await aziendaSdi()
    const [d] = await b.definitivi(az2, 1)
    const letto = await b.documento(d.id)
    await b.servizio.annulla(az2.tenantId, az2.utenteId, d.id, {
      motivo: 'prova',
      versione: letto.versione,
    })
    const r2 = await accoda(az2, [d.id])
    expect(r2.saltate).toEqual([{ documentoId: d.id, motivo: 'NON_DEFINITIVO' }])
    expect(await trasmissioni(az.tenantId)).toHaveLength(0)
    expect(await trasmissioni(az2.tenantId)).toHaveLength(0)
  }, 120_000)

  it('gia emesso (XML scaricato) senza conferma: saltato GIA_EMESSO; con conferma: accodato', async () => {
    const az = await aziendaSdi()
    const [d] = await b.definitivi(az, 1)
    await xml.xml(az.tenantId, az.utenteId, d.id, { confermaEmissione: true })
    const senza = await accoda(az, [d.id])
    expect(senza.saltate).toEqual([{ documentoId: d.id, motivo: 'GIA_EMESSO' }])
    expect(await trasmissioni(az.tenantId)).toHaveLength(0)
    const con = await accoda(az, [d.id], true)
    expect(con.accodate).toHaveLength(1)
    expect(await trasmissioni(az.tenantId)).toHaveLength(1)
  }, 90_000)

  it('data del documento nel futuro: saltato DATA_FUTURA', async () => {
    const az = await aziendaSdi()
    const [d] = await b.definitivi(az, 1)
    servizio.orologio = () => new Date('2026-01-01T10:00:00Z')
    const r = await accoda(az, [d.id])
    expect(r.saltate).toEqual([{ documentoId: d.id, motivo: 'DATA_FUTURA' }])
  }, 90_000)

  it('oltre 500 documenti: 400 TROPPI_DOCUMENTI; lista vuota: 400 NESSUN_DOCUMENTO; id non UUID: 400', async () => {
    const az = await aziendaSdi()
    const troppi = Array.from(
      { length: TETTO_DOCUMENTI_INVIO_SDI + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    )
    expect(await esito(accoda(az, troppi))).toEqual({ status: 400, codice: 'TROPPI_DOCUMENTI' })
    expect(await esito(accoda(az, []))).toEqual({ status: 400, codice: 'NESSUN_DOCUMENTO' })
    expect(await esito(accoda(az, ['non-un-uuid']))).toEqual({
      status: 400,
      codice: 'IDENTIFICATIVO_NON_VALIDO',
    })
  }, 90_000)

  it('senza configurazione: 409 SDI_NON_CONFIGURATO; invio spento: 409 INVIO_SDI_NON_ATTIVO; nulla scritto, documento non emesso', async () => {
    const senza = await aziendaSdi({ configura: false })
    const [d1] = await b.definitivi(senza, 1)
    expect(await esito(accoda(senza, [d1.id]))).toEqual({
      status: 409,
      codice: 'SDI_NON_CONFIGURATO',
    })
    const spenta = await aziendaSdi({ attiva: false })
    const [d2] = await b.definitivi(spenta, 1)
    expect(await esito(accoda(spenta, [d2.id]))).toEqual({
      status: 409,
      codice: 'INVIO_SDI_NON_ATTIVO',
    })
    expect(await trasmissioni(senza.tenantId)).toHaveLength(0)
    expect(await trasmissioni(spenta.tenantId)).toHaveLength(0)
    expect((await documentoRiga(d1.id)).emesso_il).toBeNull()
    expect((await documentoRiga(d2.id)).emesso_il).toBeNull()
  }, 120_000)

  it.each([undefined, '', 'false', '1', 'TRUE'])(
    'interruttore globale SDI_INVII_ATTIVI=%p: 409 INVII_SDI_SOSPESI e il documento NON diventa emesso',
    async valore => {
      const az = await aziendaSdi()
      const [d] = await b.definitivi(az, 1)
      if (valore === undefined) delete process.env.SDI_INVII_ATTIVI
      else process.env.SDI_INVII_ATTIVI = valore
      expect(await esito(accoda(az, [d.id]))).toEqual({
        status: 409,
        codice: 'INVII_SDI_SOSPESI',
      })
      expect(await trasmissioni(az.tenantId)).toHaveLength(0)
      expect((await documentoRiga(d.id)).emesso_il).toBeNull()
    },
    90_000
  )

  it('isolamento: un documento di un altra azienda e NON_TROVATO', async () => {
    const a = await aziendaSdi()
    const altra = await aziendaSdi()
    const [d] = await b.definitivi(altra, 1)
    const r = await accoda(a, [d.id])
    expect(r.saltate).toEqual([{ documentoId: d.id, motivo: 'NON_TROVATO' }])
    expect(await trasmissioni(altra.tenantId)).toHaveLength(0)
  }, 90_000)

  it('riprova: solo da ERRORE_INVIO, con gli stessi byte e lo stesso nome file; altrimenti 409 RIPROVA_NON_AMMESSA', async () => {
    const az = await aziendaSdi()
    const [d] = await b.definitivi(az, 1)
    const prima = await accoda(az, [d.id])
    // Viva: non si riprova.
    expect(await esito(servizio.riprova(az.tenantId, az.utenteId, d.id))).toEqual({
      status: 409,
      codice: 'RIPROVA_NON_AMMESSA',
    })
    // Porta la trasmissione a ERRORE_INVIO (DA_INVIARE -> IN_INVIO -> ERRORE_INVIO) come il job.
    const id = prima.accodate[0].trasmissioneId
    await owner.$executeRawUnsafe(
      `UPDATE trasmissioni_sdi SET stato = 'IN_INVIO' WHERE id = $1::uuid`,
      id
    )
    await owner.$executeRawUnsafe(
      `UPDATE trasmissioni_sdi SET stato = 'ERRORE_INVIO', ultimo_errore_codice = 'PROVA' WHERE id = $1::uuid`,
      id
    )
    const nuova = await servizio.riprova(az.tenantId, az.utenteId, d.id)
    expect(nuova.trasmissioneId).not.toBe(id)
    const righe = await trasmissioni(az.tenantId)
    expect(righe.map(r => r.stato)).toEqual(['ERRORE_INVIO', 'DA_INVIARE'])
    expect(righe[1].nome_file).toBe(righe[0].nome_file)
    expect(righe[1].xml_sha256).toBe(righe[0].xml_sha256)
    // Ora ce n'e' una viva: di nuovo respinta.
    expect(await esito(servizio.riprova(az.tenantId, az.utenteId, d.id))).toEqual({
      status: 409,
      codice: 'RIPROVA_NON_AMMESSA',
    })
  }, 90_000)
})
