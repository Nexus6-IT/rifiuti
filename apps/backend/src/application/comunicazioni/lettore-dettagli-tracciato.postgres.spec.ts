/**
 * Lettore dei dettagli per i tracciati a record (4.9c-f, A5) contro un Postgres reale, collegato
 * COME `wasteflow_app` dentro il `TenantContext` dell'azienda. Prova anche che le query restano
 * poche e fisse al crescere dei movimenti (niente N+1).
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
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { leggiDettagliTracciato, type DbDettagli } from './lettore-dettagli-tracciato'

describe('Lettore dettagli tracciato — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []

  const nel = <R>(az: AziendaMud, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, fn)

  /** Conta le chiamate `findMany` su ogni modello letto: il totale deve restare fisso. */
  function contaQuery(): { db: DbDettagli; totale: () => number } {
    let n = 0
    const modelli = [
      'fIR',
      'fIRTransporter',
      'sedeDitta',
      'ditta',
      'anagraficaComunicazioniSede',
      'trasportatore',
      'destinatario',
      'produttore',
      'datiTracciatoMovimento',
    ] as const
    const db = Object.fromEntries(
      modelli.map(m => [
        m,
        {
          findMany: (args: never) => {
            n++
            return (app[m] as unknown as { findMany: (a: never) => Promise<unknown> }).findMany(
              args
            )
          },
        },
      ])
    ) as unknown as DbDettagli
    return { db, totale: () => n }
  }

  async function nuovaAzienda(sigla: string) {
    const az = await creaAziendaMud(owner, sigla, { province: 'MI' })
    tenantCreati.push(az.tenantId)
    return az
  }

  async function creaFir(
    az: AziendaMud,
    o: {
      numero: string
      produttoreSedeId: string
      destinatarioSedeId: string
      trasportatoreId: string
      destinatarioId: string
    }
  ): Promise<string> {
    const fir = await owner.fIR.create({
      data: {
        tenantId: az.tenantId,
        firNumber: o.numero,
        status: 'COMPLETED',
        producerUserId: az.utenteId,
        producerSedeId: o.produttoreSedeId,
        receiverSedeId: o.destinatarioSedeId,
        producerCodiceFiscale: 'PRDCFS80A01H501U',
        carrierCodiceFiscale: 'TRSCFS80A01H501U',
        receiverCodiceFiscale: 'DSTCFS80A01H501U',
        producerPartitaIva: '01234567890',
        producerName: 'Produttore SRL',
        producerAddress: 'Via Roma 1, Napoli',
        carrierId: o.trasportatoreId,
        carrierPartitaIva: '11111111119',
        carrierName: 'Trasporti SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverId: o.destinatarioId,
        receiverPartitaIva: '22222222226',
        receiverName: 'Recuperi SRL',
        receiverAddress: 'Via Po 2, Napoli',
        cerCode: '13 02 05*',
        wasteDescription: 'Olio',
        wasteCategory: 'PERICOLOSO',
        quantity: 100,
        wasteOperationType: 'RECOVERY',
        wasteOperationCode: 'R13',
        transportDate: new Date('2026-05-10T08:00:00Z'),
      },
    })
    await owner.fIRTransporter.create({
      data: {
        firId: fir.id,
        tenantId: az.tenantId,
        ordine: 1,
        tipoTratta: 'TERRESTRE',
        denominazione: 'Trasporti SRL',
        codiceFiscale: 'TRSCFS80A01H501U',
        numeroIscrizioneAlbo: 'NA/1234',
        mezzo: 'AB123CD',
      },
    })
    return fir.id
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    const where = { tenantId: { in: tenantCreati } }
    await owner.datiTracciatoMovimento.deleteMany({ where })
    await owner.anagraficaComunicazioniSede.deleteMany({ where })
    await owner.produttore.deleteMany({ where })
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('carica FIR, sedi con ditta e sede legale, anagrafica, trasportatore e dati del tracciato; un movimento senza FIR resta senza', async () => {
    const az = await nuovaAzienda('D1')
    const prod = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE', {
      ragioneSociale: 'Produttore SRL',
      comune: 'Napoli',
      provincia: 'NA',
    })
    // Seconda sede (non principale) della ditta del produttore: la sede del FIR non e' la legale.
    const secondaSede = await owner.sedeDitta.create({
      data: {
        tenantId: az.tenantId,
        dittaId: prod.dittaId,
        via: 'Via Lunga',
        civico: '9',
        cap: '80100',
        comune: 'Napoli',
        provincia: 'NA',
        principale: false,
      },
    })
    const dest = await creaDittaConRuolo(owner, az.tenantId, 'DESTINATARIO', {
      ragioneSociale: 'Recuperi SRL',
    })
    const tras = await creaDittaConRuolo(owner, az.tenantId, 'TRASPORTATORE', {
      ragioneSociale: 'Trasporti SRL',
    })
    await owner.anagraficaComunicazioniSede.create({
      data: {
        tenantId: az.tenantId,
        sedeDittaId: secondaSede.id,
        codiceAteco: '38.11.00',
        eComune: false,
      },
    })
    const firId = await creaFir(az, {
      numero: 'ABC123/26',
      produttoreSedeId: secondaSede.id,
      destinatarioSedeId: dest.sedeId,
      trasportatoreId: tras.ruoloId,
      destinatarioId: dest.ruoloId,
    })
    const conFir = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 100,
      giorno: '2026-05-10',
      firId,
    })
    const senzaFir = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 50,
      giorno: '2026-05-11',
    })
    const rettificato = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 70,
      giorno: '2026-05-12',
    })
    const rettifica = await creaMovimento(owner, az, {
      tipo: 'RETTIFICA',
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantita: 75,
      giorno: '2026-05-12',
      rettificatoId: rettificato.id,
      originaleId: rettificato.id,
    })
    await owner.datiTracciatoMovimento.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        verso: 'CARICO',
        movimentoOriginaleId: rettificato.id,
        tracciato: 'CONOU',
        dati: { prodotto: 'A' },
        versioneSchema: 1,
      },
    })

    const movimenti = [
      { firId, radiceId: conFir.id },
      { firId: null, radiceId: senzaFir.id },
      // La rettifica ha come radice il movimento originale: e' la' che stanno i dati.
      { firId: null, radiceId: rettificato.id },
      { firId: null, radiceId: rettifica.id },
    ]
    const d = await nel(az, () =>
      leggiDettagliTracciato(app, { tenantId: az.tenantId, movimenti, tracciato: 'CONOU' })
    )

    const fir = d.fir.get(firId)
    expect(fir).toMatchObject({
      firNumero: 'ABC123/26',
      producerSedeId: secondaSede.id,
      receiverSedeId: dest.sedeId,
      carrierId: tras.ruoloId,
      carrierVehiclePlate: 'AB123CD',
      trasportatore1: { numeroIscrizioneAlbo: 'NA/1234', mezzo: 'AB123CD' },
    })
    expect(d.fir.size).toBe(1)

    const sede = d.sedi.get(secondaSede.id)
    expect(sede?.ditta.ragioneSociale).toBe('Produttore SRL')
    expect(sede?.anagrafica?.codiceAteco).toBe('38.11.00')
    // La sede del FIR non e' la legale: la legale della ditta e' la principale, caricata a parte.
    expect(d.sedeLegalePerDitta.get(prod.dittaId)?.id).toBe(prod.sedeId)
    expect(d.sedi.get(dest.sedeId)?.anagrafica).toBeNull()
    // Trasportatore e destinatario di anagrafica, con la sede del trasportatore (il FIR non l'ha).
    expect(d.trasportatori.get(tras.ruoloId)).toMatchObject({
      numeroIscrizione: expect.any(String),
      sedeId: tras.sedeId,
    })
    expect(d.sedi.get(tras.sedeId)?.ditta.ragioneSociale).toBe('Trasporti SRL')
    expect(d.destinatari.get(dest.ruoloId)?.sedeId).toBe(dest.sedeId)

    expect([...d.datiTracciato.keys()]).toEqual([rettificato.id])
    expect(d.datiTracciato.get(rettificato.id)).toEqual({ prodotto: 'A' })
  })

  it('senza FIR e senza dati: mappe vuote e nessuna query inutile', async () => {
    const az = await nuovaAzienda('D2')
    const m = await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '20 03 01',
      quantita: 10,
      giorno: '2026-05-10',
    })
    const { db, totale } = contaQuery()
    const d = await nel(az, () =>
      leggiDettagliTracciato(db, {
        tenantId: az.tenantId,
        movimenti: [{ firId: null, radiceId: m.id }],
      })
    )
    expect(d.fir.size + d.sedi.size + d.trasportatori.size + d.datiTracciato.size).toBe(0)
    expect(totale()).toBe(0)
  })

  it('il numero di query non dipende dal numero di movimenti (niente N+1)', async () => {
    const az = await nuovaAzienda('D3')
    const prod = await creaDittaConRuolo(owner, az.tenantId, 'PRODUTTORE')
    const dest = await creaDittaConRuolo(owner, az.tenantId, 'DESTINATARIO')
    const tras = await creaDittaConRuolo(owner, az.tenantId, 'TRASPORTATORE')
    const movimenti: Array<{ firId: string | null; radiceId: string }> = []
    for (let i = 0; i < 6; i++) {
      const firId = await creaFir(az, {
        numero: `N${i}/26`,
        produttoreSedeId: prod.sedeId,
        destinatarioSedeId: dest.sedeId,
        trasportatoreId: tras.ruoloId,
        destinatarioId: dest.ruoloId,
      })
      const m = await creaMovimento(owner, az, {
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '13 02 05*',
        quantita: 10 + i,
        giorno: '2026-05-10',
        firId,
      })
      movimenti.push({ firId, radiceId: m.id })
    }
    const uno = contaQuery()
    await nel(az, () =>
      leggiDettagliTracciato(uno.db, {
        tenantId: az.tenantId,
        movimenti: movimenti.slice(0, 1),
        tracciato: 'CONOU',
      })
    )
    const sei = contaQuery()
    const d = await nel(az, () =>
      leggiDettagliTracciato(sei.db, { tenantId: az.tenantId, movimenti, tracciato: 'CONOU' })
    )
    expect(d.fir.size).toBe(6)
    expect(sei.totale()).toBe(uno.totale())
    expect(sei.totale()).toBeLessThanOrEqual(9)
  })

  describe('sede della controparte scelta nel form (colonna del movimento)', () => {
    async function dittaConSedi(az: AziendaMud, nome: string) {
      const ditta = await owner.ditta.create({
        data: { tenantId: az.tenantId, ragioneSociale: nome, partitaIva: partitaIvaUnica() },
      })
      const sede = (principale: boolean, attiva: boolean, comune: string) =>
        owner.sedeDitta.create({
          data: {
            tenantId: az.tenantId,
            dittaId: ditta.id,
            via: 'Via Roma',
            civico: '1',
            cap: '38060',
            comune,
            provincia: 'TN',
            principale,
            attiva,
          },
        })
      return {
        ditta,
        legale: await sede(true, true, 'Calliano'),
        chiusa: await sede(false, false, 'Trento'),
      }
    }

    it('carica la sede della colonna anche senza FIR e senza nome; `attiva` riflette il database', async () => {
      const az = await nuovaAzienda('D5')
      const { ditta, legale, chiusa } = await dittaConSedi(az, 'Comune di Calliano')
      const m = await creaMovimento(owner, az, {
        type: 'CARICO',
        causale: 'INGRESSO_ESTERNO',
        cerCode: '20 03 01',
        quantita: 10,
        giorno: '2026-05-10',
        counterpartSedeId: chiusa.id,
      })
      const { db } = contaQuery()
      const d = await nel(az, () =>
        leggiDettagliTracciato(db, {
          tenantId: az.tenantId,
          movimenti: [{ firId: null, radiceId: m.id, sedeControparteId: chiusa.id }],
        })
      )
      expect(d.sedi.get(chiusa.id)).toMatchObject({
        id: chiusa.id,
        attiva: false,
        principale: false,
      })
      expect(d.sedi.get(chiusa.id)?.ditta.ragioneSociale).toBe(ditta.ragioneSociale)
      // La sede legale della stessa ditta si carica per la sede legale, ed e' attiva.
      expect(d.sedeLegalePerDitta.get(ditta.id)).toMatchObject({ id: legale.id, attiva: true })
    })

    it('non legge la sede di un’altra azienda (il filtro per tenant resta)', async () => {
      const a = await nuovaAzienda('D6a')
      const b = await nuovaAzienda('D6b')
      const { legale } = await dittaConSedi(b, 'Altra ditta')
      const d = await nel(a, () =>
        leggiDettagliTracciato(app, {
          tenantId: a.tenantId,
          movimenti: [
            {
              firId: null,
              radiceId: '00000000-0000-4000-8000-000000000000',
              sedeControparteId: legale.id,
            },
          ],
        })
      )
      expect(d.sedi.size).toBe(0)
    })

    it('il numero di query resta fisso: la sede della colonna entra nella stessa findMany per id', async () => {
      const az = await nuovaAzienda('D7')
      const sedi: string[] = []
      for (let i = 0; i < 5; i++) sedi.push((await dittaConSedi(az, `Ditta ${i}`)).legale.id)
      const richiesta = (ids: string[]) => ({
        tenantId: az.tenantId,
        movimenti: ids.map(id => ({
          firId: null,
          radiceId: '00000000-0000-4000-8000-000000000000',
          sedeControparteId: id,
        })),
      })
      const uno = contaQuery()
      await nel(az, () => leggiDettagliTracciato(uno.db, richiesta(sedi.slice(0, 1))))
      const cinque = contaQuery()
      const d = await nel(az, () => leggiDettagliTracciato(cinque.db, richiesta(sedi)))
      expect(d.sedi.size).toBe(5)
      expect(cinque.totale()).toBe(uno.totale())
    })
  })

  it('non legge righe di un’altra azienda', async () => {
    const a = await nuovaAzienda('D4a')
    const b = await nuovaAzienda('D4b')
    const prod = await creaDittaConRuolo(owner, b.tenantId, 'PRODUTTORE')
    const dest = await creaDittaConRuolo(owner, b.tenantId, 'DESTINATARIO')
    const tras = await creaDittaConRuolo(owner, b.tenantId, 'TRASPORTATORE')
    const firB = await creaFir(b, {
      numero: 'B/26',
      produttoreSedeId: prod.sedeId,
      destinatarioSedeId: dest.sedeId,
      trasportatoreId: tras.ruoloId,
      destinatarioId: dest.ruoloId,
    })
    const d = await nel(a, () =>
      leggiDettagliTracciato(app, {
        tenantId: a.tenantId,
        movimenti: [{ firId: firB, radiceId: '00000000-0000-4000-8000-000000000000' }],
        tracciato: 'CONOU',
      })
    )
    expect(d.fir.size).toBe(0)
    expect(d.sedi.size).toBe(0)
  })
})
