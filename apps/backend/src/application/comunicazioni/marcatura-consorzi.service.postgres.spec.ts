/**
 * Marcatura per consorzio e estratto CSV (4.9b, T10-T11) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda. Il proprietario
 * prepara i dati; la pulizia toglie solo le righe create qui, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaAziendaMud,
  creaCausaleAzienda,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { MarcaturaConsorziService } from './marcatura-consorzi.service'
import { EstrattoConsorziService } from './estratto-consorzi.service'
import {
  ConsorzioRegolaNonModificabileError,
  MarcaturaNonValidaError,
  MovimentoNonTrovatoError,
  RegolaConsorzioNonTrovataError,
} from './marcatura-consorzi.port'

describe('Marcatura per consorzio — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: MarcaturaConsorziService
  let estratto: EstrattoConsorziService
  const tenantCreati: string[] = []

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    return az
  }

  const carico = (az: AziendaMud, cerCode: string, giorno: string, extra = {}) =>
    creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode,
      quantita: 100,
      unita: 'KG',
      giorno,
      ...extra,
    })

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    servizio = new MarcaturaConsorziService(app)
    estratto = new EstrattoConsorziService(app, servizio)
  })

  afterAll(async () => {
    // Le correzioni puntano ai movimenti (NO ACTION): prima loro, poi il resto.
    const where = { tenantId: { in: tenantCreati } }
    await owner.datiConsorzioMovimento.deleteMany({ where })
    await owner.regolaConsorzio.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  describe('regole', () => {
    it('crea, elenca (con quelle di sistema), modifica ed elimina; il CER si normalizza', async () => {
      const az = await nuovaAzienda('R1')
      const vuote = await nel(az, () => servizio.elencaRegole(az.tenantId))
      expect(vuote.every(r => r.sistema && r.inVigore)).toBe(true)
      expect(vuote.map(r => [r.consorzio, r.cer, r.cerEsatto])).toEqual([
        ['CONOU', '13', false],
        ['COBAT', '160601', true],
        ['COBAT', '200133', true],
      ])

      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, {
          consorzio: 'CONOU',
          cer: '13 02',
          verso: 'CARICO',
        })
      )
      expect(creata).toMatchObject({
        consorzio: 'CONOU',
        cer: '1302',
        cerEsatto: false,
        verso: 'CARICO',
        attiva: true,
        sistema: false,
      })
      const dopo = await nel(az, () => servizio.elencaRegole(az.tenantId))
      // Alla prima regola propria di CONOU la regola di sistema e' stata copiata fra quelle
      // dell'azienda (I2): non compare piu' come «di sistema». COBAT resta di sistema.
      expect(dopo.filter(r => r.consorzio === 'CONOU').map(r => [r.cer, r.sistema])).toEqual([
        ['13', false],
        ['1302', false],
      ])
      expect(dopo.filter(r => r.consorzio === 'COBAT').every(r => r.sistema && r.inVigore)).toBe(
        true
      )

      const modificata = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'CONOU',
          cer: '130205',
          attiva: false,
        })
      )
      expect(modificata).toMatchObject({
        cer: '130205',
        cerEsatto: true,
        attiva: false,
        verso: null,
      })

      await nel(az, () => servizio.eliminaRegola(az.tenantId, creata.id as string))
      const finale = await nel(az, () => servizio.elencaRegole(az.tenantId))
      // Resta la copia della regola di sistema, che l'azienda puo' togliere a sua volta.
      expect(finale.filter(r => !r.sistema).map(r => [r.consorzio, r.cer])).toEqual([
        ['CONOU', '13'],
      ])
    })

    it('rifiuta consorzio, CER, verso, data e registro non validi', async () => {
      const az = await nuovaAzienda('R2')
      const altra = await nuovaAzienda('R2b')
      const prova = (input: Parameters<MarcaturaConsorziService['creaRegola']>[2]) =>
        nel(az, () => servizio.creaRegola(az.tenantId, az.utenteId, input))
      await expect(prova({ consorzio: 'ORSO', cer: '13' })).rejects.toBeInstanceOf(
        MarcaturaNonValidaError
      )
      await expect(prova({ consorzio: 'CONOU', cer: '131' })).rejects.toBeInstanceOf(
        MarcaturaNonValidaError
      )
      await expect(prova({ consorzio: 'CONOU', cer: '13', verso: 'X' })).rejects.toBeInstanceOf(
        MarcaturaNonValidaError
      )
      await expect(
        prova({ consorzio: 'CONOU', cer: '13', validaDal: '01/01/2026' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      // Registro di un'altra azienda.
      await expect(
        prova({ consorzio: 'CONOU', cer: '13', registroId: altra.registroId })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
    })

    it('RLS: un’azienda non vede, non modifica e non elimina le regole di un’altra', async () => {
      const a = await nuovaAzienda('R3a')
      const b = await nuovaAzienda('R3b')
      const regola = await nel(a, () =>
        servizio.creaRegola(a.tenantId, a.utenteId, { consorzio: 'COBAT', cer: '160601' })
      )
      const diB = await nel(b, () => servizio.elencaRegole(b.tenantId))
      expect(diB.some(r => r.id === regola.id)).toBe(false)
      await expect(
        nel(b, () =>
          servizio.modificaRegola(b.tenantId, regola.id as string, {
            consorzio: 'COBAT',
            cer: '16',
          })
        )
      ).rejects.toBeInstanceOf(RegolaConsorzioNonTrovataError)
      await expect(
        nel(b, () => servizio.eliminaRegola(b.tenantId, regola.id as string))
      ).rejects.toBeInstanceOf(RegolaConsorzioNonTrovataError)
      expect(
        (await nel(a, () => servizio.elencaRegole(a.tenantId))).some(r => r.id === regola.id)
      ).toBe(true)
    })

    it('I1: una regola nuova senza data vale da sempre; una uguale a quella di sistema non cambia l’estratto del passato', async () => {
      const az = await nuovaAzienda('R4')
      await carico(az, '13 02 05*', '2026-05-10')
      const prima = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(prima.righe).toBe(1)
      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, { consorzio: 'CONOU', cer: '13' })
      )
      expect(creata.validaDal).toBe('1970-01-01')
      const dopo = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(dopo.righe).toBe(1)
    })

    it('I2: alla prima regola propria le regole di sistema del consorzio si copiano fra quelle dell’azienda, una volta sola', async () => {
      const az = await nuovaAzienda('R5')
      const batt = await carico(az, '16 06 01*', '2026-05-10')
      const nichel = await carico(az, '16 06 02*', '2026-05-11')
      const portatili = await carico(az, '20 01 33*', '2026-05-12')
      await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, { consorzio: 'COBAT', cer: '16 06 02*' })
      )
      await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, { consorzio: 'COBAT', cer: '16 06 03*' })
      )
      const proprie = await owner.regolaConsorzio.findMany({
        where: { tenantId: az.tenantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      // 2 copie di sistema + 2 nuove: la seconda creazione non copia di nuovo.
      expect(proprie.map(r => r.cerEsatto).sort()).toEqual(['160601', '160602', '160603', '200133'])
      expect(proprie.every(r => r.consorzio === 'COBAT' && r.creataDa === az.utenteId)).toBe(true)
      // Aggiungere una regola non toglie niente: le tre batterie restano marcate COBAT.
      const r = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [batt.id, nichel.id, portatili.id])
      )
      expect(r[batt.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      expect(r[nichel.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      expect(r[portatili.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      // CONOU non e' stato toccato: resta di sistema, senza copie.
      const elenco = await nel(az, () => servizio.elencaRegole(az.tenantId))
      expect(elenco.filter(x => x.consorzio === 'CONOU').every(x => x.sistema)).toBe(true)
      expect(elenco.filter(x => x.consorzio === 'COBAT').every(x => !x.sistema)).toBe(true)
      // L'azienda puo' togliere una copia: 20 01 33* smette di marcare.
      const copia = elenco.find(x => x.consorzio === 'COBAT' && x.cer === '200133')
      await nel(az, () => servizio.eliminaRegola(az.tenantId, copia?.id as string))
      const dopo = await nel(az, () => servizio.consorziDeiMovimenti(az.tenantId, [portatili.id]))
      expect(dopo[portatili.id].marcature).toEqual([])
    })

    it('I2: creazioni in parallelo della prima regola non duplicano le copie', async () => {
      const az = await nuovaAzienda('R6')
      await Promise.all(
        ['16 06 02*', '16 06 03*', '16 06 04'].map(cer =>
          nel(az, () => servizio.creaRegola(az.tenantId, az.utenteId, { consorzio: 'COBAT', cer }))
        )
      )
      const n = await owner.regolaConsorzio.count({
        where: { tenantId: az.tenantId, cerEsatto: '160601' },
      })
      expect(n).toBe(1)
    })

    it('I4: la causale deve esistere nel catalogo (maiuscole comprese)', async () => {
      const az = await nuovaAzienda('R7')
      const prova = (causaleCodice: string) =>
        nel(az, () =>
          servizio.creaRegola(az.tenantId, az.utenteId, {
            consorzio: 'CONOU',
            cer: '13',
            causaleCodice,
          })
        )
      await expect(prova('ingresso_esterno')).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(prova('Ingresso da officina')).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(prova('AZ_NON_ESISTE')).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      const ok = await prova('INGRESSO_ESTERNO')
      expect(ok.causaleCodice).toBe('INGRESSO_ESTERNO')
      // Spazi attorno al codice: si tolgono, poi si controlla.
      const spazi = await prova('  INGRESSO_ESTERNO ')
      expect(spazi.causaleCodice).toBe('INGRESSO_ESTERNO')
    })

    it('la modifica non azzera i campi facoltativi assenti (registroId, attiva, validaDal)', async () => {
      const az = await nuovaAzienda('R8')
      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, {
          consorzio: 'COREPLA',
          cer: '15 01 02',
          registroId: az.registroId,
          attiva: false,
          validaDal: '2026-03-01',
        })
      )
      const dopo = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'COREPLA',
          cer: '15 01 02',
          verso: 'CARICO',
        })
      )
      expect(dopo).toMatchObject({
        registroId: az.registroId,
        attiva: false,
        validaDal: '2026-03-01',
        verso: 'CARICO',
      })
      // Un valore esplicito invece si applica, anche null per il registro.
      const sciolta = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'COREPLA',
          cer: '15 01 02',
          registroId: null,
          attiva: true,
        })
      )
      expect(sciolta).toMatchObject({ registroId: null, attiva: true })
    })

    it('I-A: il consorzio di una regola non si cambia in modifica (400), la regola resta com’è', async () => {
      const az = await nuovaAzienda('R9')
      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, { consorzio: 'CONOU', cer: '1302' })
      )
      await expect(
        nel(az, () =>
          servizio.modificaRegola(az.tenantId, creata.id as string, {
            consorzio: 'COBAT',
            cer: '1302',
          })
        )
      ).rejects.toBeInstanceOf(ConsorzioRegolaNonModificabileError)
      const riga = await owner.regolaConsorzio.findUniqueOrThrow({
        where: { id: creata.id as string },
      })
      expect(riga.consorzio).toBe('CONOU')
      // COBAT non e' stato toccato: nessuna copia, resta di sistema.
      expect(
        await owner.regolaConsorzio.count({ where: { tenantId: az.tenantId, consorzio: 'COBAT' } })
      ).toBe(0)
      // Stesso consorzio: la modifica funziona.
      const ok = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'CONOU',
          cer: '1303',
        })
      )
      expect(ok.cer).toBe('1303')
    })

    it('I-B: in modifica «da sempre» (1970-01-01) riporta la regola a valere dal passato', async () => {
      const az = await nuovaAzienda('R10')
      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, {
          consorzio: 'CONOU',
          cer: '13',
          validaDal: '2026-11-01',
        })
      )
      expect(creata.validaDal).toBe('2026-11-01')
      const dopo = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'CONOU',
          cer: '13',
          validaDal: null,
        })
      )
      expect(dopo.validaDal).toBe('1970-01-01')
    })

    it('date inesistenti (30 febbraio) -> 400 in regola ed estratto', async () => {
      const az = await nuovaAzienda('R11')
      await expect(
        nel(az, () =>
          servizio.creaRegola(az.tenantId, az.utenteId, {
            consorzio: 'CONOU',
            cer: '13',
            validaDal: '2026-02-30',
          })
        )
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        nel(az, () =>
          estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-03-01', a: '2026-02-30' })
        )
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        nel(az, () =>
          estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-02-30', a: '2026-04-01' })
        )
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
    })

    it('causale ritirata dal catalogo: la regola esistente si salva se la causale non cambia, una nuova scelta no', async () => {
      const az = await nuovaAzienda('R12')
      await creaCausaleAzienda(owner, az.tenantId, {
        codice: 'AZ_RITIRATA',
        verso: 'CARICO',
        ruolo: 'RICEVUTO_DA_TERZI',
        dal: '2026-01-01',
      })
      const creata = await nel(az, () =>
        servizio.creaRegola(az.tenantId, az.utenteId, {
          consorzio: 'CONOU',
          cer: '13',
          causaleCodice: 'AZ_RITIRATA',
        })
      )
      await owner.$executeRawUnsafe(
        `UPDATE causali_registro_azienda SET valida_al = '2026-02-01' WHERE tenant_id = $1::uuid AND codice = 'AZ_RITIRATA'`,
        az.tenantId
      )
      const disattivata = await nel(az, () =>
        servizio.modificaRegola(az.tenantId, creata.id as string, {
          consorzio: 'CONOU',
          cer: '13',
          causaleCodice: 'AZ_RITIRATA',
          attiva: false,
        })
      )
      expect(disattivata).toMatchObject({ attiva: false, causaleCodice: 'AZ_RITIRATA' })
      await expect(
        nel(az, () =>
          servizio.creaRegola(az.tenantId, az.utenteId, {
            consorzio: 'COBAT',
            cer: '16',
            causaleCodice: 'AZ_RITIRATA',
          })
        )
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
    })
  })

  describe('classificazione e correzione sul singolo movimento', () => {
    it('le regole di sistema marcano CONOU (13 xx xx) e COBAT (16 06 01*, 20 01 33*), non altro', async () => {
      const az = await nuovaAzienda('C1')
      const olio = await carico(az, '13 02 05*', '2026-05-10')
      const batt = await carico(az, '16 06 01*', '2026-05-11')
      const portatili = await carico(az, '20 01 33*', '2026-05-12')
      const altro = await carico(az, '20 03 01', '2026-05-13')
      const r = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [olio.id, batt.id, portatili.id, altro.id])
      )
      expect(r[olio.id].marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA' }])
      expect(r[batt.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      expect(r[portatili.id].marcature.map(m => m.consorzio)).toEqual(['COBAT'])
      expect(r[altro.id]).toEqual({ marcature: [], esclusi: [] })
    })

    it('marcatura ed esclusione manuali; una sola riga per movimento e consorzio; togliere la correzione torna alle regole', async () => {
      const az = await nuovaAzienda('C2')
      const olio = await carico(az, '13 02 05*', '2026-05-10')
      const urbano = await carico(az, '20 03 01', '2026-05-11')

      const escluso = await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, olio.id, 'CONOU', true)
      )
      expect(escluso).toEqual({ marcature: [], esclusi: ['CONOU'] })
      const manuale = await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, urbano.id, 'COREPLA', false)
      )
      expect(manuale.marcature).toEqual([{ consorzio: 'COREPLA', origine: 'MANUALE' }])

      // Impostare di nuovo lo stesso consorzio aggiorna la riga, non ne crea una seconda.
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, olio.id, 'CONOU', false)
      )
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, olio.id, 'CONOU', true)
      )
      const righe = await owner.datiConsorzioMovimento.findMany({
        where: { tenantId: az.tenantId, movimentoOriginaleId: olio.id },
      })
      expect(righe).toHaveLength(1)
      expect(righe[0].escluso).toBe(true)

      const tolto = await nel(az, () => servizio.rimuoviOverride(az.tenantId, olio.id, 'CONOU'))
      expect(tolto.marcature).toEqual([{ consorzio: 'CONOU', origine: 'REGOLA' }])
      // Idempotente.
      await nel(az, () => servizio.rimuoviOverride(az.tenantId, olio.id, 'CONOU'))
    })

    it('la correzione sta sulla radice: segue la rettifica (anche col CER corretto) e sopravvive all’annullamento', async () => {
      const az = await nuovaAzienda('C3')
      const radice = await carico(az, '20 03 01', '2026-05-10')
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, radice.id, 'COREPLA', false)
      )
      const rettifica = await creaMovimento(owner, az, {
        tipo: 'RETTIFICA',
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 80,
        giorno: '2026-05-10',
        rettificatoId: radice.id,
        originaleId: radice.id,
      })
      // Impostata sulla rettifica, la correzione finisce comunque sulla radice (stessa riga).
      const daRettifica = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [rettifica.id])
      )
      expect(daRettifica[rettifica.id].marcature).toEqual([
        { consorzio: 'COREPLA', origine: 'MANUALE' },
      ])
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, rettifica.id, 'COREPLA', true)
      )
      expect(await owner.datiConsorzioMovimento.count({ where: { tenantId: az.tenantId } })).toBe(1)
      const dopo = await nel(az, () =>
        servizio.consorziDeiMovimenti(az.tenantId, [radice.id, rettifica.id])
      )
      expect(dopo[radice.id].esclusi).toEqual([])
      expect(dopo[radice.id].marcature).toEqual([])

      // Annullamento: la catena esce dai conteggi, la correzione resta sulla radice e non da' errori.
      await creaMovimento(owner, az, {
        tipo: 'ANNULLAMENTO',
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 80,
        giorno: '2026-05-10',
        rettificatoId: rettifica.id,
        originaleId: radice.id,
      })
      const csv = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'COREPLA', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(csv.righe).toBe(0)
      expect(await owner.datiConsorzioMovimento.count({ where: { tenantId: az.tenantId } })).toBe(1)
    })

    it('la correzione segue la rettifica anche se cambia il CER: vale il CER vigente, la correzione resta sulla radice', async () => {
      const az = await nuovaAzienda('C5')
      const radice = await carico(az, '13 02 05*', '2026-05-10')
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, radice.id, 'CONOU', true)
      )
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, radice.id, 'COREPLA', false)
      )
      const prima = await nel(az, () => servizio.consorziDeiMovimenti(az.tenantId, [radice.id]))
      expect(prima[radice.id].esclusi).toEqual(['CONOU'])
      const rettifica = await creaMovimento(owner, az, {
        tipo: 'RETTIFICA',
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '16 06 01*',
        quantita: 100,
        giorno: '2026-05-10',
        rettificatoId: radice.id,
        originaleId: radice.id,
      })
      const dopo = await nel(az, () => servizio.consorziDeiMovimenti(az.tenantId, [rettifica.id]))
      // Il CER ora e' 16 06 01*: COBAT per regola. L'esclusione CONOU non ha piu' una regola da
      // escludere, la marcatura manuale COREPLA resta.
      expect(dopo[rettifica.id].marcature).toEqual([
        { consorzio: 'COBAT', origine: 'REGOLA' },
        { consorzio: 'COREPLA', origine: 'MANUALE' },
      ])
      expect(dopo[rettifica.id].esclusi).toEqual([])
      const csvConou = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-05-01', a: '2026-05-31' })
      )
      const csvCobat = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'COBAT', da: '2026-05-01', a: '2026-05-31' })
      )
      expect([csvConou.righe, csvCobat.righe]).toEqual([0, 1])
    })

    it('RLS: movimento di un’altra azienda -> non trovato; le correzioni non si vedono fra aziende', async () => {
      const a = await nuovaAzienda('C4a')
      const b = await nuovaAzienda('C4b')
      const mov = await carico(a, '13 02 05*', '2026-05-10')
      await expect(
        nel(b, () => servizio.impostaOverride(b.tenantId, b.utenteId, mov.id, 'CONOU', true))
      ).rejects.toBeInstanceOf(MovimentoNonTrovatoError)
      await expect(
        nel(b, () => servizio.impostaOverride(b.tenantId, b.utenteId, mov.id, 'ORSO', true))
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await nel(a, () => servizio.impostaOverride(a.tenantId, a.utenteId, mov.id, 'CONOU', true))
      // Dal contesto di B la riga di A non esiste.
      const viste = await nel(b, () => app.datiConsorzioMovimento.findMany({ where: {} }))
      expect(viste).toEqual([])
      expect(
        (await nel(b, () => servizio.consorziDeiMovimenti(b.tenantId, [mov.id])))[mov.id]
      ).toBeUndefined()
    })
  })

  describe('estratto CSV', () => {
    it('contiene solo i movimenti vigenti marcati per il consorzio nel periodo, con controparte, CER, kg e FIR', async () => {
      const az = await nuovaAzienda('E1')
      const altra = await nuovaAzienda('E1b')
      await carico(az, '13 02 05*', '2026-05-10', {
        counterpartName: 'Officina Rossi',
        counterpartAddress: 'Via Roma 1',
      })
      await carico(az, '13 02 05*', '2026-07-01') // fuori periodo
      await carico(az, '20 03 01', '2026-05-11') // non marcato
      await carico(altra, '13 02 05*', '2026-05-10') // altra azienda
      const manuale = await carico(az, '20 03 01', '2026-05-12', { counterpartName: '=CMD()' })
      await nel(az, () =>
        servizio.impostaOverride(az.tenantId, az.utenteId, manuale.id, 'CONOU', false)
      )

      const r = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(r.righe).toBe(2)
      expect(r.nomeFile).toBe('estratto-conou-2026-05-01_2026-05-31.csv')
      const linee = r.csv.split('\r\n')
      expect(linee[1]).toContain('"CONOU";"10/05/2026"')
      expect(linee[1]).toContain('"13 02 05*"')
      expect(linee[1]).toContain('"Officina Rossi"')
      expect(linee[1]).toContain('"100"')
      expect(linee[1].endsWith('"Regola"')).toBe(true)
      expect(linee[2]).toContain('"\'=CMD()"')
      expect(linee[2].endsWith('"Manuale"')).toBe(true)
    })

    it('I3: i limiti del periodo sono i giorni di Roma, non la mezzanotte UTC', async () => {
      const az = await nuovaAzienda('E3')
      // 28/2 23:30 a Roma (ora solare) = 22:30Z: fuori da marzo.
      await carico(az, '13 02 05*', '', { istante: '2026-02-28T22:30:00Z' })
      // 1/3 00:30 a Roma = 28/2 23:30Z: dentro marzo.
      await carico(az, '13 02 05*', '', { istante: '2026-02-28T23:30:00Z' })
      // 31/3 23:30 a Roma (ora legale, +2) = 21:30Z: dentro marzo.
      await carico(az, '13 02 05*', '', { istante: '2026-03-31T21:30:00Z' })
      // 1/4 00:30 a Roma = 31/3 22:30Z: fuori da marzo.
      await carico(az, '13 02 05*', '', { istante: '2026-03-31T22:30:00Z' })
      const r = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-03-01', a: '2026-03-31' })
      )
      const date = r.csv
        .split('\r\n')
        .slice(1, -1)
        .map(l => l.split(';')[1])
      expect(date).toEqual(['"01/03/2026"', '"31/03/2026"'])
    })

    it('I5: «tutte le sedi» include i registri senza sede, il filtro per una sede li esclude', async () => {
      const az = await nuovaAzienda('E4')
      const senzaSede = await owner.registroRifiuti.create({
        data: { tenantId: az.tenantId, descrizione: 'Registro storico', unitaLocaleId: null },
      })
      await carico(az, '13 02 05*', '2026-05-10')
      await creaMovimento(
        owner,
        { ...az, registroId: senzaSede.id },
        {
          type: 'CARICO',
          causale: 'INGRESSO_ESTERNO',
          cerCode: '13 02 05*',
          quantita: 50,
          unita: 'KG',
          giorno: '2026-05-11',
        }
      )
      const tutte = await nel(az, () =>
        estratto.estratto(az.tenantId, { consorzio: 'CONOU', da: '2026-05-01', a: '2026-05-31' })
      )
      expect(tutte.righe).toBe(2)
      const unaSede = await nel(az, () =>
        estratto.estratto(az.tenantId, {
          consorzio: 'CONOU',
          da: '2026-05-01',
          a: '2026-05-31',
          unitaLocaleId: az.unitaLocaleId,
        })
      )
      expect(unaSede.righe).toBe(1)
      await owner.wasteMovement.deleteMany({ where: { registroId: senzaSede.id } })
      await owner.registroRifiuti.delete({ where: { id: senzaSede.id } })
    })

    it('periodo o consorzio non validi -> errore, sede di un’altra azienda -> errore', async () => {
      const az = await nuovaAzienda('E2')
      const altra = await nuovaAzienda('E2b')
      const chiama = (p: Parameters<EstrattoConsorziService['estratto']>[1]) =>
        nel(az, () => estratto.estratto(az.tenantId, p))
      await expect(
        chiama({ consorzio: 'ORSO', da: '2026-01-01', a: '2026-01-31' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({ consorzio: 'CONOU', da: '2026-02-01', a: '2026-01-31' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({ consorzio: 'CONOU', da: '2026-02-30', a: '2026-03-01' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({ consorzio: 'CONOU', da: '2000-01-01', a: '2026-01-31' })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
      await expect(
        chiama({
          consorzio: 'CONOU',
          da: '2026-01-01',
          a: '2026-01-31',
          unitaLocaleId: altra.unitaLocaleId,
        })
      ).rejects.toBeInstanceOf(MarcaturaNonValidaError)
    })
  })
})
