/**
 * Servizio dei ritiri (4.7, T10) contro un Postgres reale, collegato COME `wasteflow_app`
 * (RLS ENABLE+FORCE) e dentro il `TenantContext` dell'azienda. Il proprietario prepara aziende,
 * anagrafiche e FIR (il FIR vero lo scrive T9): la pulizia cancella SOLO le aziende create qui,
 * per id esatto (la cascata da `tenants` porta via il resto).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

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
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  RitiroConFirError,
  RitiroDatiNonValidiError,
  RitiroModificatoError,
  RitiroNonTrovatoError,
  RitiroStatoNonValidoError,
} from './errori-ritiri'
import { RitiriService } from './ritiri.service'
import type { NuovoRitiro } from './ritiri.tipi'

describe('Servizio ritiri — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: RitiriService
  const tenantCreati: string[] = []
  const cerFinto = {
    exists: async () => true,
    isUtilizzabilePerNuovoFormulario: async () => true,
  } as unknown as ICERRepository

  interface Azienda {
    t: string
    utente: string
    produttore: string
    produttoreSede: string
    trasportatore: string
    destinatario: string
    destinatarioSede: string
    automezzo: string
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Ritiri SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-ritsvc-${sigla}`,
          fiscalCode: `RSV${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Ritiri',
          email: `ritsvc-${sigla}@example.test`,
          role: 'ADMIN',
        },
      })
    ).id
    const p = await creaDittaConRuolo(owner, t, 'PRODUTTORE')
    const tr = await creaDittaConRuolo(owner, t, 'TRASPORTATORE')
    const d = await creaDittaConRuolo(owner, t, 'DESTINATARIO')
    const automezzo = (
      await owner.automezzo.create({ data: { tenantId: t, targa: 'AB123CD', creatoDa: utente } })
    ).id
    return {
      t,
      utente,
      produttore: p.ruoloId,
      produttoreSede: p.sedeId,
      trasportatore: tr.ruoloId,
      destinatario: d.ruoloId,
      destinatarioSede: d.sedeId,
      automezzo,
    }
  }

  const nuovo = (a: Azienda, extra: Partial<NuovoRitiro> = {}): NuovoRitiro => ({
    dataPrevista: '2026-12-01',
    produttoreId: a.produttore,
    produttoreSedeId: a.produttoreSede,
    trasportatoreId: a.trasportatore,
    destinatarioId: a.destinatario,
    destinatarioSedeId: a.destinatarioSede,
    cerCode: '200301',
    descrizione: 'Rifiuti urbani non differenziati',
    quantitaPresunta: '1250.5',
    codiceOperazione: 'R13',
    provenienza: 'SPECIALE' as const,
    tipoTratta: 'TERRESTRE' as const,
    chiaveIdempotenza: crypto.randomUUID(),
    ...extra,
  })

  async function fir(a: Azienda, ritiroId: string, status = 'DRAFT'): Promise<string> {
    const x = partitaIvaUnica()
    return (
      await owner.fIR.create({
        data: {
          tenantId: a.t,
          producerUserId: a.utente,
          ritiroId,
          producerPartitaIva: x,
          producerName: 'Produttore',
          producerAddress: 'Via Prova 1',
          carrierPartitaIva: x,
          carrierName: 'Trasportatore',
          carrierVehiclePlate: 'AB123CD',
          receiverPartitaIva: x,
          receiverName: 'Destinatario',
          receiverAddress: 'Via Destinazione 1',
          cerCode: '20 03 01',
          wasteDescription: 'Rifiuto di prova',
          wasteCategory: 'Non pericoloso',
          quantity: 100,
          unit: 'KG',
          status: status as 'DRAFT',
          transportDate: new Date(),
        },
        select: { id: true },
      })
    ).id
  }

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  const righeRitiri = (a: Azienda) =>
    owner
      .$queryRawUnsafe<
        { n: number }[]
      >(`SELECT count(*)::int AS n FROM ritiri WHERE tenant_id = '${a.t}'`)
      .then(r => r[0].n)

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new RitiriService(app, new RitiriRepository(), cerFinto)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    for (const t of tenantCreati) {
      try {
        await owner.tenant.delete({ where: { id: t } })
      } catch (e) {
        console.error(`pulizia ritiri.service: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('creazione e ripetizione', () => {
    it('crea un ritiro singolo con la vista completa', async () => {
      const a = await azienda()
      const r = await nelTenant(a.t, () =>
        servizio.crea(a.t, a.utente, nuovo(a, { automezzoId: a.automezzo, ordineGiro: 2 }))
      )
      expect(r.giaRegistrato).toBe(false)
      expect(r.ritiri).toHaveLength(1)
      const v = r.ritiri[0]
      expect(v).toMatchObject({
        dataPrevista: '2026-12-01',
        cerCode: '20 03 01',
        quantitaPresunta: '1250.50',
        unita: 'KG',
        stato: 'PROGRAMMATO',
        statoVisibile: 'DA_GENERARE',
        fir: null,
        serieId: null,
        versione: 1,
        ordineGiro: 2,
        automezzo: { id: a.automezzo, targa: 'AB123CD' },
      })
      expect(v.produttore.indirizzo).toBe('Via Roma 1, 00100 Roma (RM)')
    })

    it('ripetizione di 5: 5 righe con lo stesso serie_id; stessa chiave = nessuna riga in più', async () => {
      const a = await azienda()
      const dati = nuovo(a, { ripetizione: { ogniSettimane: 1, fino: '2026-12-29' } })
      const r = await nelTenant(a.t, () => servizio.crea(a.t, a.utente, dati))
      expect(r.ritiri.map(x => x.dataPrevista)).toEqual([
        '2026-12-01',
        '2026-12-08',
        '2026-12-15',
        '2026-12-22',
        '2026-12-29',
      ])
      const serie = new Set(r.ritiri.map(x => x.serieId))
      expect(serie.size).toBe(1)
      expect([...serie][0]).not.toBeNull()

      const bis = await nelTenant(a.t, () => servizio.crea(a.t, a.utente, dati))
      expect(bis.giaRegistrato).toBe(true)
      expect(bis.ritiri.map(x => x.id)).toEqual(r.ritiri.map(x => x.id))
      expect(await righeRitiri(a)).toBe(5)
    })

    it('due richieste in parallelo con la stessa chiave: una serie sola', async () => {
      const a = await azienda()
      const dati = nuovo(a, { ripetizione: { ogniGiorni: 2, fino: '2026-12-09' } })
      const [x, y] = await Promise.all([
        nelTenant(a.t, () => servizio.crea(a.t, a.utente, dati)),
        nelTenant(a.t, () => servizio.crea(a.t, a.utente, dati)),
      ])
      expect([x.giaRegistrato, y.giaRegistrato].sort()).toEqual([false, true])
      expect(await righeRitiri(a)).toBe(5)
    })

    it('oltre 52 occorrenze è un errore, non un troncamento: nessuna riga', async () => {
      const a = await azienda()
      await expect(
        nelTenant(a.t, () =>
          servizio.crea(
            a.t,
            a.utente,
            nuovo(a, { ripetizione: { ogniGiorni: 1, fino: '2027-06-01' } })
          )
        )
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
      expect(await righeRitiri(a)).toBe(0)
    })

    it('rifiuta una sede che non è della ditta, un automezzo altrui e un produttore inesistente', async () => {
      const a = await azienda()
      const b = await azienda()
      for (const extra of [
        { produttoreSedeId: a.destinatarioSede },
        { automezzoId: b.automezzo },
        { produttoreId: crypto.randomUUID() },
        { trasportatoreId: b.trasportatore },
      ]) {
        await expect(
          nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a, extra)))
        ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
      }
      expect(await righeRitiri(a)).toBe(0)
    })

    it('un CER non valido nel catalogo è un errore di dati', async () => {
      const a = await azienda()
      const rifiuta = new RitiriService(app, new RitiriRepository(), {
        exists: async () => false,
        isUtilizzabilePerNuovoFormulario: async () => false,
      } as unknown as ICERRepository)
      await expect(
        nelTenant(a.t, () => rifiuta.crea(a.t, a.utente, nuovo(a)))
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
    })
  })

  describe('modifica, annulla, non eseguito, riprogramma', () => {
    it('modifica con versione vecchia: 409; con quella giusta la versione sale', async () => {
      const a = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      const dati = { ...nuovo(a, { quantitaPresunta: '99' }), versione: 1 }
      const m = await nelTenant(a.t, () => servizio.modifica(a.t, r.id, dati))
      expect(m.versione).toBe(2)
      expect(m.quantitaPresunta).toBe('99.00')
      await expect(
        nelTenant(a.t, () => servizio.modifica(a.t, r.id, { ...dati, versione: 1 }))
      ).rejects.toBeInstanceOf(RitiroModificatoError)
    })

    it('annulla con motivo; un ritiro annullato non si modifica né si riprogramma', async () => {
      const a = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      const x = await nelTenant(a.t, () => servizio.annulla(a.t, a.utente, r.id, '  doppione ', 1))
      expect(x).toMatchObject({
        stato: 'ANNULLATO',
        statoVisibile: 'ANNULLATO',
        motivo: 'doppione',
        versione: 2,
      })
      await expect(
        nelTenant(a.t, () => servizio.modifica(a.t, r.id, { ...nuovo(a), versione: 2 }))
      ).rejects.toBeInstanceOf(RitiroStatoNonValidoError)
      await expect(
        nelTenant(a.t, () => servizio.riprogramma(a.t, r.id, '2026-12-10', 2))
      ).rejects.toBeInstanceOf(RitiroStatoNonValidoError)
      await expect(
        nelTenant(a.t, () => servizio.annulla(a.t, a.utente, r.id, 'ancora', 2))
      ).rejects.toBeInstanceOf(RitiroStatoNonValidoError)
    })

    it('il motivo è obbligatorio', async () => {
      const a = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      await expect(
        nelTenant(a.t, () => servizio.annulla(a.t, a.utente, r.id, '   ', 1))
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
      await expect(
        nelTenant(a.t, () => servizio.nonEseguito(a.t, r.id, '', 1))
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
    })

    it('non eseguito, poi riprogramma: torna PROGRAMMATO con data nuova e senza motivo', async () => {
      const a = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      const n = await nelTenant(a.t, () => servizio.nonEseguito(a.t, r.id, 'cancello chiuso', 1))
      expect(n).toMatchObject({
        stato: 'NON_ESEGUITO',
        statoVisibile: 'NON_ESEGUITO',
        motivo: 'cancello chiuso',
      })
      const p = await nelTenant(a.t, () =>
        servizio.riprogramma(a.t, r.id, '2026-12-20', n.versione)
      )
      expect(p).toMatchObject({
        stato: 'PROGRAMMATO',
        statoVisibile: 'DA_GENERARE',
        motivo: null,
        dataPrevista: '2026-12-20',
        versione: 3,
      })
    })

    it('con un FIR attivo modifica, annulla e non eseguito rispondono 409 RITIRO_CON_FIR', async () => {
      const a = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      await fir(a, r.id, 'DRAFT')
      await expect(
        nelTenant(a.t, () => servizio.modifica(a.t, r.id, { ...nuovo(a), versione: 1 }))
      ).rejects.toBeInstanceOf(RitiroConFirError)
      await expect(
        nelTenant(a.t, () => servizio.annulla(a.t, a.utente, r.id, 'no', 1))
      ).rejects.toBeInstanceOf(RitiroConFirError)
      await expect(
        nelTenant(a.t, () => servizio.nonEseguito(a.t, r.id, 'no', 1))
      ).rejects.toBeInstanceOf(RitiroConFirError)
      const d = await nelTenant(a.t, () => servizio.dettaglio(a.t, r.id))
      expect(d).toMatchObject({ stato: 'PROGRAMMATO', versione: 1, statoVisibile: 'FIR_BOZZA' })
    })

    it('con il FIR annullato il ritiro si annulla e il dettaglio mostra i FIR precedenti', async () => {
      const a = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      const vecchio = await fir(a, r.id, 'CANCELLED')
      const prima = await nelTenant(a.t, () => servizio.dettaglio(a.t, r.id))
      expect(prima.statoVisibile).toBe('DA_GENERARE')
      expect(prima.fir).toBeNull()
      expect(prima.firPrecedenti?.map(f => f.id)).toEqual([vecchio])
      const x = await nelTenant(a.t, () => servizio.annulla(a.t, a.utente, r.id, 'rinuncia', 1))
      expect(x.stato).toBe('ANNULLATO')
    })

    it('un altro tenant non vede il ritiro e id malformati sono 404', async () => {
      const a = await azienda()
      const b = await azienda()
      const [r] = (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a)))).ritiri
      await expect(nelTenant(b.t, () => servizio.dettaglio(b.t, r.id))).rejects.toBeInstanceOf(
        RitiroNonTrovatoError
      )
      await expect(
        nelTenant(b.t, () => servizio.annulla(b.t, b.utente, r.id, 'x', 1))
      ).rejects.toBeInstanceOf(RitiroNonTrovatoError)
      await expect(nelTenant(a.t, () => servizio.dettaglio(a.t, 'x; DROP'))).rejects.toBeInstanceOf(
        RitiroNonTrovatoError
      )
    })
  })

  describe('lista', () => {
    it('filtra e ordina; lo stato visibile segue il FIR attivo, con una sola query', async () => {
      const a = await azienda()
      const crea = async (extra: Partial<NuovoRitiro>) =>
        (await nelTenant(a.t, () => servizio.crea(a.t, a.utente, nuovo(a, extra)))).ritiri[0]
      const r1 = await crea({ dataPrevista: '2026-12-03', automezzoId: a.automezzo, ordineGiro: 2 })
      const r2 = await crea({ dataPrevista: '2026-12-03', automezzoId: a.automezzo, ordineGiro: 1 })
      const r3 = await crea({ dataPrevista: '2026-12-02' })
      const r4 = await crea({ dataPrevista: '2026-12-05', cerCode: '150101' })
      const r5 = await crea({ dataPrevista: '2026-12-06' })
      await fir(a, r1.id, 'AWAITING_CARRIER')
      await fir(a, r4.id, 'COMPLETED')
      await fir(a, r5.id, 'CANCELLED')
      await nelTenant(a.t, () => servizio.nonEseguito(a.t, r3.id, 'assente', 1))

      // una sola query: un solo $queryRaw sul tx e nessun altro accesso al client
      const accessi: string[] = []
      const originale = app.$transaction.bind(app) as (fn: (tx: unknown) => unknown) => unknown
      const spia = jest.spyOn(app, '$transaction').mockImplementation(((
        fn: (tx: unknown) => unknown
      ) =>
        originale(tx =>
          fn(
            new Proxy(tx as object, {
              get(t, p) {
                if (typeof p === 'string') accessi.push(p)
                const v = Reflect.get(t, p)
                return typeof v === 'function' ? v.bind(t) : v
              },
            })
          )
        )) as never)
      const tutti = await nelTenant(a.t, () => servizio.elenca(a.t))
      spia.mockRestore()
      expect(accessi).toEqual(['$queryRaw'])

      expect(tutti.totale).toBe(5)
      // data, mezzo (null in coda), ordine nel giro, creazione
      expect(tutti.righe.map(r => r.id)).toEqual([r3.id, r2.id, r1.id, r4.id, r5.id])
      const stato = Object.fromEntries(tutti.righe.map(r => [r.id, r.statoVisibile]))
      expect(stato).toEqual({
        [r1.id]: 'FIR_EMESSO',
        [r2.id]: 'DA_GENERARE',
        [r3.id]: 'NON_ESEGUITO',
        [r4.id]: 'CONSEGNATO',
        [r5.id]: 'DA_GENERARE',
      })
      expect(tutti.righe.find(r => r.id === r1.id)?.fir).toMatchObject({
        status: 'AWAITING_CARRIER',
      })

      const idsDi = async (f: Parameters<RitiriService['elenca']>[1]) =>
        (await nelTenant(a.t, () => servizio.elenca(a.t, f))).righe.map(r => r.id).sort()
      expect(await idsDi({ statoVisibile: 'DA_GENERARE' })).toEqual([r2.id, r5.id].sort())
      expect(await idsDi({ statoVisibile: 'CONSEGNATO' })).toEqual([r4.id])
      expect(await idsDi({ statoVisibile: 'FIR_EMESSO' })).toEqual([r1.id])
      expect(await idsDi({ statoVisibile: 'NON_ESEGUITO' })).toEqual([r3.id])
      expect(await idsDi({ statoVisibile: 'FIR_BOZZA' })).toEqual([])
      expect(await idsDi({ dal: '2026-12-03', al: '2026-12-05' })).toEqual(
        [r1.id, r2.id, r4.id].sort()
      )
      expect(await idsDi({ automezzoId: a.automezzo })).toEqual([r1.id, r2.id].sort())
      expect(await idsDi({ cerCode: '15 01 01' })).toEqual([r4.id])
      expect(await idsDi({ cerCode: '150101' })).toEqual([r4.id])
      expect(await idsDi({ produttoreId: a.produttore })).toHaveLength(5)

      const pag = await nelTenant(a.t, () => servizio.elenca(a.t, { pagina: 2, dimensione: 2 }))
      expect(pag.totale).toBe(5)
      expect(pag.righe.map(r => r.id)).toEqual([r1.id, r4.id])
    })

    it('filtri malformati: errore di dati, non 500', async () => {
      const a = await azienda()
      await expect(
        nelTenant(a.t, () => servizio.elenca(a.t, { dal: 'ieri', automezzoId: 'x' }))
      ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
    })

    it('2.000 ritiri in meno di un secondo', async () => {
      const a = await azienda()
      await owner.$executeRawUnsafe(`
        INSERT INTO ritiri (tenant_id, data_prevista, produttore_id, produttore_sede_id,
          trasportatore_id, destinatario_id, destinatario_sede_id, automezzo_id, cer_code,
          descrizione, quantita_presunta, tipo_operazione, creato_da, updated_at, ordine_giro)
        SELECT '${a.t}', DATE '2026-12-01' + (g % 60), '${a.produttore}', '${a.produttoreSede}',
          '${a.trasportatore}', '${a.destinatario}', '${a.destinatarioSede}',
          CASE WHEN g % 3 = 0 THEN '${a.automezzo}'::uuid END, '20 03 01', 'Massa ' || g, 10 + g,
          'DISPOSAL', '${a.utente}', now(), g % 40 + 1
        FROM generate_series(1, 2000) g`)
      await owner.$executeRawUnsafe(`
        INSERT INTO firs (tenant_id, producer_user_id, ritiro_id, producer_partita_iva, producer_name,
          producer_address, carrier_partita_iva, carrier_name, carrier_vehicle_plate,
          receiver_partita_iva, receiver_name, receiver_address, cer_code, waste_description,
          waste_category, quantity, unit, status, transport_date, updated_at)
        SELECT tenant_id, '${a.utente}', id, '12345678903', 'P', 'Via', '12345678903', 'T', 'AB123CD',
          '12345678903', 'D', 'Via', '20 03 01', 'x', 'Non pericoloso', 1, 'KG', 'DRAFT', now(), now()
        FROM ritiri WHERE tenant_id = '${a.t}' AND ordine_giro <= 10`)
      const inizio = Date.now()
      const r = await nelTenant(a.t, () => servizio.elenca(a.t, { dimensione: 2000 }))
      const ms = Date.now() - inizio
      expect(r.totale).toBe(2000)
      expect(r.righe).toHaveLength(2000)
      expect(r.righe.filter(x => x.statoVisibile === 'FIR_BOZZA').length).toBe(500)
      expect(ms).toBeLessThan(1000)
    })
  })
})
