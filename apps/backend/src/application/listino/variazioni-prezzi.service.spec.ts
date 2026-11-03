import { BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { VariazioniPrezziService } from './variazioni-prezzi.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const R1 = 'c1c1c1c1-0000-4000-8000-000000000001'
const R2 = 'c2c2c2c2-0000-4000-8000-000000000002'
const R3 = 'c3c3c3c3-0000-4000-8000-000000000003'
const F1 = 'f1f1f1f1-0000-4000-8000-000000000001'

const riga = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  versione: 1,
  tipo: 'V',
  cerCode: null,
  prezzo: '10.000000',
  prezzoSpeciale: false,
  minimo: null,
  addebitoCodice: '90001',
  elencoCodice: '001',
  contrattoId: 'k1',
  contratto: 'C-1',
  inizio: '2010-03-15',
  cliente: 'CLI',
  ...extra,
})

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('VariazioniPrezziService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: VariazioniPrezziService
  let righe: any[]
  let fasce: any[]
  let testi: string[]
  let valori: unknown[][]

  beforeEach(() => {
    righe = [riga(R1), riga(R2, { prezzoSpeciale: true, prezzo: null })]
    fasce = [{ id: F1, rigaId: R2, prezzo: '0.100000' }]
    testi = []
    valori = []
    tx = {
      rigaAddebito: { findMany: jest.fn(async () => righe.map(r => ({ id: r.id }))) },
      codiceIva: { findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: unknown[]) => {
        const s = strings.join('?')
        testi.push(s)
        valori.push(v)
        if (s.includes('FROM righe_addebito\n      JOIN unnest')) {
          return righe.map(r => ({
            ...r,
            elencoId: `e-${r.contrattoId}`,
            addebitoId: r.addebitoCodice ? 'a1' : null,
          }))
        }
        if (s.includes('FROM elenchi_addebiti')) {
          return righe.map(r => ({
            id: `e-${r.contrattoId}`,
            codice: r.elencoCodice,
            contrattoId: r.contrattoId,
          }))
        }
        if (s.includes('FROM contratti_cliente')) {
          // Un contratto per data di inizio: il test ISTAT ne usa due.
          return righe.map(r => ({
            id: r.contrattoId,
            numero: r.contratto,
            inizio: r.inizio,
            clienteId: 'cl1',
          }))
        }
        if (s.includes('FROM clienti')) return [{ id: 'cl1', codice: 'CLI' }]
        if (s.includes('FROM addebiti')) return [{ id: 'a1', codice: '90001' }]
        if (s.includes('prezzo::text AS prezzo') && s.includes('scaglioni_riga_addebito'))
          return fasce
        return []
      }),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...v: unknown[]) => {
        testi.push(strings.join('?'))
        valori.push(v)
        return 1
      }),
      activityLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new VariazioniPrezziService(prisma)
  })

  const corpo = (extra: Record<string, unknown> = {}) =>
    ({ tipo: 'AUMENTO_PERCENTUALE', valore: '10', filtri: {}, ...extra }) as any
  const conImpronta = async (c = corpo()) => ({
    ...c,
    impronta: (await service.anteprima(T, c)).impronta,
  })

  describe('anteprima', () => {
    it('forma di R46: cliente, contratto, elenco, voce; fasce separate da barre', async () => {
      const a = await service.anteprima(T, corpo())
      expect(a.righe).toEqual([
        {
          id: R1,
          cliente: 'CLI',
          contratto: 'C-1',
          elenco: '001',
          voce: '90001',
          prima: '10.00',
          dopo: '11.00',
          invariata: false,
        },
        {
          id: R2,
          cliente: 'CLI',
          contratto: 'C-1',
          elenco: '001',
          voce: '90001',
          prima: '0.10',
          dopo: '0.11',
          invariata: false,
        },
      ])
      expect(a.totale).toBe(2)
      expect(a.invariate).toBe(0)
      expect(a.righe.every(r => r.invariata === false)).toBe(true)
      expect(a.impronta).toMatch(/^[0-9a-f]{64}$/)
    })

    it('mostra al massimo 200 righe ma le conta tutte', async () => {
      righe = Array.from({ length: 250 }, (_, i) =>
        riga(`d${String(i).padStart(7, '0')}-0000-4000-8000-000000000000`)
      )
      const a = await service.anteprima(T, corpo())
      expect(a.totale).toBe(250)
      expect(a.righe).toHaveLength(200)
    })

    it('più di 10.000 righe: 400 VARIAZIONE_TROPPE_RIGHE', async () => {
      tx.rigaAddebito.findMany.mockResolvedValueOnce(
        Array.from({ length: 10_001 }, (_, i) => ({ id: String(i) }))
      )
      const e = await errore(service.anteprima(T, corpo()))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_TROPPE_RIGHE' })
    })

    it('prezzo negativo: nell’elenco errori, non nelle righe', async () => {
      const a = await service.anteprima(T, corpo({ tipo: 'DIMINUZIONE_IMPORTO', valore: '11' }))
      expect(a.righe).toEqual([])
      expect(a.errori.map(e => e.id)).toEqual([R1, R2])
    })

    it('ogni filtro e’ passato alla query (azienda sempre presente)', async () => {
      await service.anteprima(
        T,
        corpo({ filtri: { cerCode: '200301', inizioDal: '2026-01-01', tipi: ['V'] } })
      )
      const { where } = tx.rigaAddebito.findMany.mock.calls[0][0]
      expect(JSON.stringify(where)).toContain(T)
      expect(JSON.stringify(where)).toContain('20 03 01')
      expect(JSON.stringify(where)).toContain('ANNULLATO')
    })

    it.each([
      [
        'soloMinimi con la sostituzione IVA',
        corpo({
          tipo: 'SOSTITUZIONE_IVA',
          daCodiceIvaId: 'a',
          aCodiceIvaId: 'b',
          soloMinimi: true,
        }),
      ],
      [
        'due codici IVA uguali',
        corpo({ tipo: 'SOSTITUZIONE_IVA', daCodiceIvaId: 'a', aCodiceIvaId: 'a' }),
      ],
      ['identificativo non valido', corpo({ filtri: { clienteId: 'non-un-uuid' } })],
      ['data non reale', corpo({ filtri: { fineAl: '2026-13-01' } })],
    ])('%s: 400', async (_n, c) => {
      expect((await errore(service.anteprima(T, c))).status).toBe(400)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('applicazione', () => {
    it('SET LOCAL lock_timeout prima di tutto; lock delle righe per id, poi delle fasce per (riga, ordine)', async () => {
      const c = await conImpronta()
      testi.length = 0
      await service.applica(T, U, c)
      expect(testi[0]).toMatch(/SET LOCAL lock_timeout/)
      const lock = testi.filter(t => /FOR NO KEY UPDATE/.test(t))
      expect(lock).toHaveLength(2)
      expect(lock[0]).toMatch(/FROM righe_addebito r[\s\S]*ORDER BY r\.id FOR NO KEY UPDATE OF r/)
      expect(lock[1]).toMatch(
        /FROM scaglioni_riga_addebito s[\s\S]*ORDER BY s\.riga_id, s\.ordine FOR NO KEY UPDATE OF s/
      )
      expect(testi.some(t => /FOR UPDATE/.test(t.replace(/NO KEY UPDATE/g, '')))).toBe(false)
    })

    it('una sola istruzione per riga: prezzo e versione insieme (niente deadlock con chi salva)', async () => {
      const c = await conImpronta()
      testi.length = 0
      await service.applica(T, U, c)
      const aggiornaRighe = testi.filter(t => /UPDATE righe_addebito/.test(t))
      // Prezzi (con versione) + sola versione per la riga che cambia solo nelle fasce.
      expect(aggiornaRighe).toHaveLength(2)
      expect(aggiornaRighe[0]).toMatch(/SET prezzo = v\.prezzo, versione = r\.versione \+ 1/)
      expect(aggiornaRighe[1]).toMatch(/SET versione = r\.versione \+ 1/)
    })

    it('impronta diversa: 409 VARIAZIONE_SUPERATA e nessun UPDATE né audit', async () => {
      const c = await conImpronta()
      righe[0] = riga(R1, { versione: 2 })
      const e = await errore(service.applica(T, U, c))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_SUPERATA' })
      expect(testi.filter(t => /^\s*UPDATE/.test(t))).toEqual([])
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('M1: una riga entrata nel filtro dopo i lock (non bloccata): 409 VARIAZIONE_SUPERATA, nulla scritto', async () => {
      const c = await conImpronta()
      let letture = 0
      tx.rigaAddebito.findMany.mockImplementation(async () => {
        letture++
        if (letture === 2) righe.push(riga(R3, { contrattoId: 'k3' }))
        return righe.map(r => ({ id: r.id }))
      })
      testi.length = 0
      const e = await errore(service.applica(T, U, c))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_SUPERATA' })
      expect(testi.filter(t => /^\s*UPDATE/.test(t))).toEqual([])
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('I1: una riga che non cambia non entra negli UPDATE e non conta', async () => {
      righe = [riga(R1, { prezzo: '0.100000' }), riga(R2)]
      const c = await conImpronta(corpo({ valore: '3' }))
      testi.length = 0
      valori.length = 0
      const esito = await service.applica(T, U, c)
      expect(esito).toEqual({ aggiornati: 1 })
      const upd = valori[testi.findIndex(t => /UPDATE righe_addebito r/.test(t))]
      expect(upd[0]).toEqual([R2])
      const { data } = tx.activityLog.create.mock.calls[0][0]
      expect(data.metadata).toMatchObject({ righe: 1, invariate: 1, impronta: c.impronta })
    })

    it('errori nell’anteprima: 400 VARIAZIONE_CON_ERRORI, nulla scritto', async () => {
      const c = await conImpronta(corpo({ tipo: 'DIMINUZIONE_IMPORTO', valore: '11' }))
      const e = await errore(service.applica(T, U, c))
      expect(e.status).toBe(400)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_CON_ERRORI' })
      expect(testi.filter(t => /^\s*UPDATE/.test(t))).toEqual([])
    })

    it('un audit per applicazione, con parametri e conteggi senza dati personali', async () => {
      const c = await conImpronta()
      await service.applica(T, U, c)
      expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
      const { data } = tx.activityLog.create.mock.calls[0][0]
      expect(data).toMatchObject({
        tenantId: T,
        userId: U,
        action: 'PREZZI_VARIATI',
        metadata: { tipo: 'AUMENTO_PERCENTUALE', valore: '10', righe: 2, contratti: 1, fasce: 1 },
      })
      expect(JSON.stringify(data)).not.toContain('CLI')
    })

    const errPrisma = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

    it.each([
      ['P2034', errPrisma('P2034'), 'VARIAZIONE_SUPERATA'],
      ['40P01 dal raw', errPrisma('P2010', { code: '40P01' }), 'VARIAZIONE_SUPERATA'],
      ['55P03 dal raw', errPrisma('P2010', { code: '55P03' }), 'VARIAZIONE_SUPERATA'],
      ['P2028', errPrisma('P2028'), 'OPERAZIONE_CONCORRENTE'],
    ])('%s → 409 %s', async (_n, err, codice) => {
      const c = await conImpronta()
      prisma.$transaction.mockRejectedValueOnce(err)
      const e = await errore(service.applica(T, U, c))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({ error: codice })
    })
  })

  describe('ISTAT', () => {
    const istat = (extra: Record<string, unknown> = {}) =>
      ({
        percentuali: [
          { anno: 2010, mese: 3, percentuale: '3,0' },
          { anno: 2011, mese: 5, percentuale: '2.5' },
        ],
        tipi: ['V'],
        ...extra,
      }) as any

    it('ogni riga usa la percentuale del mese di inizio del suo contratto', async () => {
      righe = [
        riga(R1, { inizio: '2010-03-15' }),
        riga(R2, { inizio: '2011-05-02', prezzo: '100.000000', contrattoId: 'k2' }),
      ]
      const a = await service.anteprimaIstat(T, istat())
      expect(a.righe.map(r => [r.prima, r.dopo])).toEqual([
        ['10.00', '10.30'],
        ['100.00', '102.50'],
      ])
    })

    it('la query chiede solo i contratti col flag e i mesi indicati', async () => {
      await service.anteprimaIstat(T, istat())
      const where = JSON.stringify(tx.rigaAddebito.findMany.mock.calls[0][0].where)
      expect(where).toContain('"incrementoIstat":true')
      expect(where).toContain('2010-03-01')
      expect(where).toContain('2011-05-01')
    })

    it.each([
      [
        'crescenti',
        istat({
          percentuali: [
            { anno: 2010, mese: 3, percentuale: '1' },
            { anno: 2011, mese: 5, percentuale: '2' },
          ],
        }),
        'decrescenti',
      ],
      ['tipi mancanti', istat({ tipi: [] }), 'almeno un tipo'],
      [
        '100%',
        istat({ percentuali: [{ anno: 2010, mese: 3, percentuale: '100' }] }),
        'minore di 100',
      ],
    ])('%s: 400 ISTAT_NON_VALIDO, senza toccare il database', async (_n, c, parte) => {
      const e = await errore(service.anteprimaIstat(T, c))
      expect(e.status).toBe(400)
      expect(e.getResponse()).toMatchObject({ error: 'ISTAT_NON_VALIDO' })
      expect(JSON.stringify(e.getResponse())).toContain(parte)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('l’anno corrente non si adegua', async () => {
      const anno = new Date().getUTCFullYear()
      const e = await errore(
        service.anteprimaIstat(T, istat({ percentuali: [{ anno, mese: 1, percentuale: '2' }] }))
      )
      expect(e.status).toBe(400)
    })

    it('audit PREZZI_ISTAT con percentuali e tipi', async () => {
      const c = istat()
      const { impronta } = await service.anteprimaIstat(T, c)
      await service.applicaIstat(T, U, { ...c, impronta })
      const { data } = tx.activityLog.create.mock.calls[0][0]
      expect(data.action).toBe('PREZZI_ISTAT')
      expect(data.metadata).toMatchObject({
        tipi: ['V'],
        percentuali: [
          { anno: 2010, mese: 3, percentuale: '3' },
          { anno: 2011, mese: 5, percentuale: '2.5' },
        ],
        impronta,
      })
    })

    it('M2: l’ISTAT passa dal dominio aumentoIstat', async () => {
      const dominio = jest.requireActual('../../domain/listino/variazione-prezzi')
      const spia = jest.spyOn(dominio, 'aumentoIstat')
      await service.anteprimaIstat(T, istat())
      expect(spia).toHaveBeenCalled()
      spia.mockRestore()
    })

    it('mesi: esclude l’anno corrente e, senza parametro, il precedente', async () => {
      tx.$queryRaw.mockResolvedValueOnce([{ anno: 2010, mese: 3, contratti: 2 }])
      const anno = new Date().getUTCFullYear()
      expect(await service.mesiIstat(T, false)).toEqual([
        { anno: 2010, mese: 3, contratti: 2, ultimaApplicazione: null },
      ])
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toContain(anno - 2)
      tx.$queryRaw.mockResolvedValueOnce([])
      await service.mesiIstat(T, true)
      expect(tx.$queryRaw.mock.calls[1].slice(1)).toContain(anno - 1)
    })
  })
})
