import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ContrattiClienteService } from './contratti-cliente.service'
import { controllaRiferimenti } from '../clienti/riferimenti-fatturazione'

jest.mock('../clienti/riferimenti-fatturazione', () => ({ controllaRiferimenti: jest.fn() }))
const controlla = controllaRiferimenti as jest.Mock

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const CL = 'cccccccc-0000-4000-8000-000000000003'
const CF = 'cccccccc-0000-4000-8000-000000000033'
const D = 'dddddddd-0000-4000-8000-000000000004'
const DF = 'dddddddd-0000-4000-8000-000000000044'
const S = 'eeeeeeee-0000-4000-8000-000000000005'
const K = 'ffffffff-0000-4000-8000-000000000006'
const P = '99999999-0000-4000-8000-000000000009'
const R = (n: number) => `1111111${n}-0000-4000-8000-00000000000${n}`

const OGGI = new Date('2026-11-02T10:00:00.000Z')

const clienteEreditabile = (extra: Record<string, unknown> = {}) => ({
  id: CL,
  dittaId: D,
  attivo: true,
  contoCorrenteId: R(1),
  condizionePagamentoId: R(2),
  agenteId: R(3),
  registroIvaId: R(4),
  speseIncassoId: R(5),
  bolloId: R(6),
  esigibilitaIva: 'DIFFERITA',
  ritenutaPercentuale: '4.50',
  codiceDestinatario: 'ABCDEFG',
  riferimentoAmministrazione: null,
  ...extra,
})

const rif = (id: string, descrizione = 'Descrizione') => ({ id, codice: 'C', descrizione })

/** Riga del contratto come la restituisce Prisma con l'include della vista. */
const riga = (extra: Record<string, unknown> = {}) => ({
  id: K,
  tenantId: T,
  numero: 'CC-2026-001',
  descrizione: 'Contratto di prova',
  stato: 'BOZZA',
  dataInizio: new Date('2026-01-01T00:00:00.000Z'),
  dataFine: new Date('2026-12-31T00:00:00.000Z'),
  clienteId: CL,
  clienteFatturazioneId: null,
  sedeId: null,
  categoriaId: null,
  tipoId: null,
  condizionePagamentoId: null,
  contoCorrenteId: null,
  agenteId: null,
  speseIncassoId: null,
  bolloId: null,
  registroIvaId: null,
  testoFatturazioneId: null,
  annotazioni: [],
  esigibilitaIva: 'IMMEDIATA',
  ritenutaPercentuale: null,
  rinnovoAutomatico: false,
  codiceRinnovo: null,
  codiceDestinatario: null,
  riferimentoAmministrazione: null,
  sogliaDal: null,
  sogliaImporto: null,
  sogliaIvaEsclusa: false,
  dataStipula: null,
  commessa: null,
  validitaQuantita: null,
  validitaUnita: null,
  motivoAnnulloId: null,
  motivoAnnullo: null,
  annullatoIl: null,
  incrementoIstat: false,
  escludiDichiarazioneIntento: false,
  codiceCig: null,
  codiceCup: null,
  idDocumentoPa: null,
  contrattoPrincipaleId: null,
  eliminatoIl: null,
  versione: 1,
  cliente: {
    id: CL,
    attivo: true,
    contoCorrenteId: R(1),
    contoCorrente: rif(R(1), 'Conto del cliente'),
    ditta: { ragioneSociale: 'Cliente Rossi', partitaIva: '12345678903' },
  },
  clienteFatturazione: null,
  sede: null,
  categoria: null,
  tipo: null,
  condizionePagamento: null,
  contoCorrente: null,
  speseIncasso: null,
  bollo: null,
  registroIva: null,
  agente: null,
  testoFatturazione: null,
  motivoAnnulloCodifica: null,
  contrattoPrincipale: null,
  periodi: [],
  allegatiPdf: [],
  _count: { contrattiAllegati: 0 },
  ...extra,
})

const base = {
  numero: 'CC-2026-001',
  descrizione: 'Contratto di prova',
  clienteId: CL,
  dataInizio: '2026-01-01',
}

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

const errP = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

describe('ContrattiClienteService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let clienti: { attiviPerId: jest.Mock }
  let service: ContrattiClienteService
  /** Risposte del `$queryRaw`, per tabella citata nella query. */
  let sedi: Array<{ id: string }>
  let principali: Array<Record<string, unknown>>

  beforeEach(() => {
    controlla.mockReset().mockResolvedValue([])
    sedi = [{ id: S }]
    principali = []
    tx = {
      contrattoCliente: {
        create: jest.fn().mockResolvedValue({ id: K }),
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        count: jest.fn().mockResolvedValue(1),
      },
      periodoFatturazioneCliente: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn(async (strings: readonly string[]) => {
        const testo = strings.join('?')
        if (testo.includes('"sedi_ditte"')) return sedi
        if (testo.includes('"contratti_cliente"')) return principali
        return []
      }),
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    clienti = {
      attiviPerId: jest.fn(async (_tx: unknown, ids: string[]) => {
        const m = new Map<string, unknown>()
        for (const id of ids) {
          if (id === CL) m.set(id, clienteEreditabile())
          if (id === CF) {
            m.set(
              id,
              clienteEreditabile({
                id: CF,
                dittaId: DF,
                codiceDestinatario: 'UFE1AB',
                riferimentoAmministrazione: 'RIF-PA',
                esigibilitaIva: 'SCISSIONE',
              })
            )
          }
        }
        return m
      }),
    }
    service = new ContrattiClienteService(prisma, clienti as any, () => OGGI)
  })

  describe('crea', () => {
    it('nasce in BOZZA con versione 1 e restituisce la vista', async () => {
      const v = await service.crea(T, U, base)
      const data = tx.contrattoCliente.create.mock.calls[0][0].data
      expect(data.tenantId).toBe(T)
      expect(data.stato ?? 'BOZZA').toBe('BOZZA')
      expect(data.numero).toBe('CC-2026-001')
      expect(data.dataInizio).toEqual(new Date('2026-01-01T00:00:00.000Z'))
      expect(v.id).toBe(K)
      expect(v.stato).toBe('BOZZA')
      expect(v.versione).toBe(1)
    })

    it.each([
      ['condizionePagamentoId', R(2)],
      ['agenteId', R(3)],
      ['registroIvaId', R(4)],
      ['speseIncassoId', R(5)],
      ['bolloId', R(6)],
      ['esigibilitaIva', 'DIFFERITA'],
      ['ritenutaPercentuale', '4.50'],
      ['codiceDestinatario', 'ABCDEFG'],
    ])('copia dal cliente %s se assente nel corpo (D4)', async (campo, atteso) => {
      await service.crea(T, U, base)
      expect(tx.contrattoCliente.create.mock.calls[0][0].data[campo]).toBe(atteso)
    })

    it('copia dal cliente anche il riferimento amministrazione, insieme al codice (D4)', async () => {
      clienti.attiviPerId.mockResolvedValue(
        new Map([
          [
            CL,
            clienteEreditabile({ codiceDestinatario: 'UFE1AB', riferimentoAmministrazione: 'RIF' }),
          ],
        ])
      )
      await service.crea(T, U, base)
      const data = tx.contrattoCliente.create.mock.calls[0][0].data
      expect(data.codiceDestinatario).toBe('UFE1AB')
      expect(data.riferimentoAmministrazione).toBe('RIF')
    })

    it('non copia il conto corrente: l’effettivo si calcola nella vista (D4)', async () => {
      const v = await service.crea(T, U, base)
      expect(tx.contrattoCliente.create.mock.calls[0][0].data.contoCorrenteId ?? null).toBeNull()
      expect(v.contoCorrente).toBeNull()
      expect(v.contoCorrenteEffettivo).toEqual({
        id: R(1),
        codice: 'C',
        descrizione: 'Conto del cliente',
      })
    })

    it('i valori del corpo vincono sui predefiniti', async () => {
      await service.crea(T, U, {
        ...base,
        condizionePagamentoId: R(7),
        esigibilitaIva: 'IMMEDIATA',
        ritenutaPercentuale: '1,5',
        codiceDestinatario: 'zzzzzzz',
      })
      const data = tx.contrattoCliente.create.mock.calls[0][0].data
      expect(data.condizionePagamentoId).toBe(R(7))
      expect(data.esigibilitaIva).toBe('IMMEDIATA')
      expect(data.ritenutaPercentuale).toBe('1.50')
      expect(data.codiceDestinatario).toBe('ZZZZZZZ')
    })

    it('un null esplicito nel corpo vince sul predefinito', async () => {
      await service.crea(T, U, { ...base, agenteId: null, ritenutaPercentuale: null })
      const data = tx.contrattoCliente.create.mock.calls[0][0].data
      expect(data.agenteId).toBeNull()
      expect(data.ritenutaPercentuale).toBeNull()
      expect(data.bolloId).toBe(R(6))
    })

    it('se il corpo indica il codice destinatario, il riferimento del cliente non si eredita', async () => {
      clienti.attiviPerId.mockResolvedValue(
        new Map([
          [
            CL,
            clienteEreditabile({ codiceDestinatario: 'UFE1AB', riferimentoAmministrazione: 'RIF' }),
          ],
        ])
      )
      await service.crea(T, U, { ...base, codiceDestinatario: 'ABCDEFG' })
      const data = tx.contrattoCliente.create.mock.calls[0][0].data
      expect(data.codiceDestinatario).toBe('ABCDEFG')
      expect(data.riferimentoAmministrazione ?? null).toBeNull()
    })

    describe('recapito SDI (R35)', () => {
      it('contratto con cliente di fatturazione diverso: codice e riferimento si copiano da lui', async () => {
        await service.crea(T, U, { ...base, clienteFatturazioneId: CF })
        const data = tx.contrattoCliente.create.mock.calls[0][0].data
        expect(data.codiceDestinatario).toBe('UFE1AB')
        expect(data.riferimentoAmministrazione).toBe('RIF-PA')
        // gli altri predefiniti restano quelli del cliente
        expect(data.esigibilitaIva).toBe('DIFFERITA')
        expect(clienti.attiviPerId.mock.calls[0][1].sort()).toEqual([CF, CL].sort())
      })

      it('senza cliente di fatturazione, o uguale al cliente: si copiano dal cliente', async () => {
        await service.crea(T, U, base)
        expect(tx.contrattoCliente.create.mock.calls[0][0].data.codiceDestinatario).toBe('ABCDEFG')
        tx.contrattoCliente.create.mockClear()
        await service.crea(T, U, { ...base, clienteFatturazioneId: CL })
        const data = tx.contrattoCliente.create.mock.calls[0][0].data
        expect(data.codiceDestinatario).toBe('ABCDEFG')
        expect(data.clienteFatturazioneId ?? null).toBeNull()
      })
    })

    it('la validazione pura precede il database: 400 CONTRATTO_CLIENTE_NON_VALIDO con l’elenco', async () => {
      const e = await errore(
        service.crea(T, U, { ...base, numero: '', descrizione: '', dataInizio: '2026-01-01' })
      )
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_VALIDO')
      expect(Array.isArray(e.getResponse().message)).toBe(true)
      expect(e.getResponse().message.length).toBeGreaterThanOrEqual(2)
      expect(clienti.attiviPerId).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('cliente disattivato: 400', async () => {
      clienti.attiviPerId.mockResolvedValue(new Map([[CL, clienteEreditabile({ attivo: false })]]))
      const e = await errore(service.crea(T, U, base))
      expect(e.getResponse().message).toContain('Il cliente scelto non esiste o è disattivato.')
      expect(tx.contrattoCliente.create).not.toHaveBeenCalled()
    })

    it('cliente inesistente (o di un’altra azienda): 400', async () => {
      clienti.attiviPerId.mockResolvedValue(new Map())
      const e = await errore(service.crea(T, U, base))
      expect(e.getResponse().message).toContain('Il cliente scelto non esiste o è disattivato.')
    })

    it('cliente di fatturazione inesistente: 400', async () => {
      const e = await errore(
        service.crea(T, U, {
          ...base,
          clienteFatturazioneId: 'aaaaaaaa-1111-4000-8000-00000000ffff',
        })
      )
      expect(e.getResponse().message).toContain(
        'Il cliente di fatturazione scelto non esiste o è disattivato.'
      )
      expect(tx.contrattoCliente.create).not.toHaveBeenCalled()
    })

    it('cliente di fatturazione disattivato: 400', async () => {
      clienti.attiviPerId.mockImplementation(
        async () =>
          new Map([
            [CL, clienteEreditabile()],
            [CF, clienteEreditabile({ id: CF, attivo: false })],
          ])
      )
      const e = await errore(service.crea(T, U, { ...base, clienteFatturazioneId: CF }))
      expect(e.getResponse().message).toContain(
        'Il cliente di fatturazione scelto non esiste o è disattivato.'
      )
    })

    it('sede attiva della ditta del cliente: bloccata con FOR SHARE e accettata', async () => {
      await service.crea(T, U, { ...base, sedeId: S })
      const q = tx.$queryRaw.mock.calls.find((c: any[]) => c[0].join('?').includes('"sedi_ditte"'))
      expect(q[0].join('?')).toContain('FOR SHARE')
      expect(tx.contrattoCliente.create.mock.calls[0][0].data.sedeId).toBe(S)
    })

    it('sede di un’altra ditta: 400 "La sede scelta non è una sede attiva del cliente."', async () => {
      sedi = []
      const e = await errore(service.crea(T, U, { ...base, sedeId: S }))
      expect(e.getResponse().message).toContain('La sede scelta non è una sede attiva del cliente.')
    })

    it('riferimenti non validi: 400 con i messaggi di controllaRiferimenti, sulla riga ereditata e scelta', async () => {
      controlla.mockResolvedValue(['La condizione di pagamento scelta non esiste o è disattivata.'])
      const e = await errore(service.crea(T, U, { ...base, categoriaId: R(8) }))
      expect(e.getResponse().message).toEqual([
        'La condizione di pagamento scelta non esiste o è disattivata.',
      ])
      const passati = controlla.mock.calls[0][2]
      expect(passati.categoriaId).toBe(R(8))
      expect(passati.condizionePagamentoId).toBe(R(2))
      expect(controlla.mock.calls[0][0]).toBe(tx)
      expect(tx.contrattoCliente.create).not.toHaveBeenCalled()
    })

    describe('contratto principale (D28)', () => {
      const principale = (extra: Record<string, unknown> = {}) => ({
        id: P,
        clienteId: CL,
        stato: 'ATTIVO',
        eliminato: false,
        contrattoPrincipaleId: null,
        ...extra,
      })

      it('valido: letto con FOR UPDATE e accettato', async () => {
        principali = [principale()]
        await service.crea(T, U, { ...base, contrattoPrincipaleId: P })
        const q = tx.$queryRaw.mock.calls.find((c: any[]) =>
          c[0].join('?').includes('"contratti_cliente"')
        )
        expect(q[0].join('?')).toContain('FOR UPDATE')
        expect(tx.contrattoCliente.create.mock.calls[0][0].data.contrattoPrincipaleId).toBe(P)
      })

      it.each([
        ['di un altro cliente', { clienteId: CF }],
        ['annullato', { stato: 'ANNULLATO' }],
        ['eliminato', { eliminato: true }],
        ['allegato a sua volta', { contrattoPrincipaleId: R(9) }],
      ])('principale %s: 400', async (_nome, extra) => {
        principali = [principale(extra)]
        const e = await errore(service.crea(T, U, { ...base, contrattoPrincipaleId: P }))
        expect(e.getResponse().message).toContain(
          'Il contratto principale deve essere un contratto dello stesso cliente, non annullato e non allegato a sua volta.'
        )
      })

      it('principale inesistente: 400', async () => {
        principali = []
        const e = await errore(service.crea(T, U, { ...base, contrattoPrincipaleId: P }))
        expect(e.getResponse().message).toContain(
          'Il contratto principale deve essere un contratto dello stesso cliente, non annullato e non allegato a sua volta.'
        )
      })
    })

    it('scrive i periodi nella stessa transazione con ordine 1..n', async () => {
      await service.crea(T, U, {
        ...base,
        periodi: [
          { giornoInizio: 1, meseInizio: 4, giornoFine: 30, meseFine: 6 },
          { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 },
        ],
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      const arg = tx.periodoFatturazioneCliente.createMany.mock.calls[0][0]
      expect(arg.data).toEqual([
        {
          tenantId: T,
          contrattoId: K,
          ordine: 1,
          giornoInizio: 1,
          meseInizio: 1,
          giornoFine: 31,
          meseFine: 3,
        },
        {
          tenantId: T,
          contrattoId: K,
          ordine: 2,
          giornoInizio: 1,
          meseInizio: 4,
          giornoFine: 30,
          meseFine: 6,
        },
      ])
      expect(tx.contrattoCliente.create.mock.calls[0][0].data.periodi).toBeUndefined()
    })

    it('senza periodi non scrive righe figlie', async () => {
      await service.crea(T, U, base)
      expect(tx.periodoFatturazioneCliente.createMany).not.toHaveBeenCalled()
    })

    it('P2002 sul numero (anche con target nullo sotto RLS): 409 CONTRATTO_CLIENTE_NUMERO_DUPLICATO', async () => {
      prisma.$transaction.mockRejectedValue(errP('P2002', { target: null }))
      const e = await errore(service.crea(T, U, base))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'CONTRATTO_CLIENTE_NUMERO_DUPLICATO',
        message: 'Esiste già un contratto con questo numero.',
      })
    })

    it('audit CONTRATTO_CLIENTE_CREATO con id e numero, senza altri dati', async () => {
      await service.crea(T, U, base)
      const arg = tx.activityLog.create.mock.calls[0][0].data
      expect(arg).toMatchObject({
        tenantId: T,
        userId: U,
        action: 'CONTRATTO_CLIENTE_CREATO',
        metadata: { contrattoId: K, numero: 'CC-2026-001' },
      })
      expect(Object.keys(arg.metadata)).toEqual(['contrattoId', 'numero'])
    })
  })

  describe('prossimoNumero', () => {
    it('conta anche gli eliminati e usa l’anno corrente (data di Roma)', async () => {
      tx.contrattoCliente.findMany.mockResolvedValue([
        { numero: 'CC-2026-001' },
        { numero: 'CC-2026-007' },
        { numero: 'CC-2026-009-bis' },
      ])
      expect(await service.prossimoNumero(T)).toBe('CC-2026-008')
      const arg = tx.contrattoCliente.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({ tenantId: T, numero: { startsWith: 'CC-2026-' } })
    })

    it('senza numeri parte da 001', async () => {
      tx.contrattoCliente.findMany.mockResolvedValue([])
      expect(await service.prossimoNumero(T)).toBe('CC-2026-001')
    })

    it('a cavallo d’anno vale l’ora di Roma: 31/12 23:30 UTC e’ gia’ il nuovo anno', async () => {
      tx.contrattoCliente.findMany.mockResolvedValue([])
      const s = new ContrattiClienteService(
        prisma,
        clienti as any,
        () => new Date('2026-12-31T23:30:00.000Z')
      )
      expect(await s.prossimoNumero(T)).toBe('CC-2027-001')
    })
  })

  describe('vista', () => {
    it('campi derivati: scaduto, prossimaFinePeriodo, modificabili, transizioni, eliminabile, rinnovabile', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(
        riga({
          stato: 'ATTIVO',
          dataFine: new Date('2026-10-31T00:00:00.000Z'),
          periodi: [
            { ordine: 1, giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 },
            { ordine: 2, giornoInizio: 1, meseInizio: 10, giornoFine: 31, meseFine: 12 },
          ],
        })
      )
      const v = await service.getById(T, K)
      expect(v.scaduto).toBe(true) // oggi (Roma) = 2026-11-02
      expect(v.prossimaFinePeriodo).toBe('2026-12-31')
      expect(v.modificabili).not.toContain('numero')
      expect(v.modificabili).toContain('descrizione')
      expect(v.transizioni).toEqual(['SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'])
      expect(v.eliminabile).toBe(false)
      expect(v.rinnovabile).toBe(true)
      expect(v.dataInizio).toBe('2026-01-01')
      expect(v.dataFine).toBe('2026-10-31')
      expect(v.periodi).toEqual([
        { giornoInizio: 1, meseInizio: 1, giornoFine: 31, meseFine: 3 },
        { giornoInizio: 1, meseInizio: 10, giornoFine: 31, meseFine: 12 },
      ])
    })

    it('bozza senza allegati: eliminabile; con contratti allegati no (D13)', async () => {
      expect((await service.getById(T, K)).eliminabile).toBe(true)
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ _count: { contrattiAllegati: 2 } }))
      const v = await service.getById(T, K)
      expect(v.eliminabile).toBe(false)
      expect(v.allegati).toBe(2)
    })

    it('decimali come stringhe, riferimenti, sede, principale e PDF', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(
        riga({
          ritenutaPercentuale: new Prisma.Decimal('4.5'),
          sogliaImporto: new Prisma.Decimal('1000'),
          sede: { id: S, via: 'Via X', civico: '1', comune: 'Roma', provincia: 'RM' },
          contrattoPrincipale: { id: P, numero: 'CC-2026-000' },
          agente: { id: R(3), codice: 'A1', ditta: { ragioneSociale: 'Agenzia Verdi' } },
          testoFatturazione: { id: R(4), codice: 'T1', titolo: 'Testo' },
          contoCorrente: rif(R(1), 'Conto del contratto'),
          clienteFatturazione: { id: CF, ditta: { ragioneSociale: 'Altro', partitaIva: null } },
          allegatiPdf: [{ posizione: 1, nomeFile: 'a.pdf' }],
        })
      )
      const v = await service.getById(T, K)
      expect(v.ritenutaPercentuale).toBe('4.50')
      expect(v.sogliaImporto).toBe('1000.00')
      expect(v.sede).toEqual({ id: S, descrizione: 'Via X 1, Roma (RM)' })
      expect(v.contrattoPrincipale).toEqual({ id: P, numero: 'CC-2026-000' })
      expect(v.agente).toEqual({ id: R(3), codice: 'A1', descrizione: 'Agenzia Verdi' })
      expect(v.testoFatturazione).toEqual({ id: R(4), codice: 'T1', descrizione: 'Testo' })
      expect(v.contoCorrenteEffettivo?.descrizione).toBe('Conto del contratto')
      expect(v.clienteFatturazione).toEqual({ id: CF, ragioneSociale: 'Altro', partitaIva: null })
      expect(v.cliente).toEqual({
        id: CL,
        ragioneSociale: 'Cliente Rossi',
        partitaIva: '12345678903',
        attivo: true,
      })
      expect(v.allegatiPdf).toEqual([{ posizione: 1, nomeFile: 'a.pdf' }])
    })

    it('la lettura non porta mai il contenuto degli allegati', async () => {
      await service.getById(T, K)
      const include = tx.contrattoCliente.findFirst.mock.calls[0][0].include
      expect(include.allegatiPdf.select).toEqual({ posizione: true, nomeFile: true })
    })

    it('getById: non trovato o eliminato → 404', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, K))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(tx.contrattoCliente.findFirst.mock.calls[0][0].where).toEqual({
        id: K,
        tenantId: T,
        eliminatoIl: null,
      })
    })
  })

  describe('list', () => {
    it('esclude gli eliminati e pagina', async () => {
      tx.contrattoCliente.count.mockResolvedValue(41)
      const r = await service.list(T, { pagina: 3, dimensione: 20 })
      const arg = tx.contrattoCliente.findMany.mock.calls[0][0]
      expect(arg.where).toMatchObject({ tenantId: T, eliminatoIl: null })
      expect(arg.skip).toBe(40)
      expect(arg.take).toBe(20)
      expect(r.totale).toBe(41)
      expect(r.elementi).toHaveLength(1)
    })

    it('filtri per stato, cliente, categoria e tipo', async () => {
      await service.list(T, {
        stato: 'ATTIVO',
        clienteId: CL,
        categoriaId: R(8),
        tipoId: R(9),
        pagina: 1,
        dimensione: 20,
      })
      expect(tx.contrattoCliente.findMany.mock.calls[0][0].where).toMatchObject({
        stato: 'ATTIVO',
        clienteId: CL,
        categoriaId: R(8),
        tipoId: R(9),
      })
    })

    it('testo: numero, descrizione, commessa e ragione sociale del cliente', async () => {
      await service.list(T, { testo: 'rossi', pagina: 1, dimensione: 20 })
      const or = tx.contrattoCliente.findMany.mock.calls[0][0].where.OR
      expect(or).toEqual([
        { numero: { contains: 'rossi', mode: 'insensitive' } },
        { descrizione: { contains: 'rossi', mode: 'insensitive' } },
        { commessa: { contains: 'rossi', mode: 'insensitive' } },
        { cliente: { ditta: { ragioneSociale: { contains: 'rossi', mode: 'insensitive' } } } },
      ])
    })

    it('inScadenzaEntroGiorni: fine fra oggi e oggi + N (data di Roma)', async () => {
      await service.list(T, { inScadenzaEntroGiorni: 30, pagina: 1, dimensione: 20 })
      expect(tx.contrattoCliente.findMany.mock.calls[0][0].where.dataFine).toEqual({
        gte: new Date('2026-11-02T00:00:00.000Z'),
        lte: new Date('2026-12-02T00:00:00.000Z'),
      })
    })

    it('più viste in una pagina: nessuna query per riga', async () => {
      tx.contrattoCliente.findMany.mockResolvedValue([
        riga(),
        riga({ id: P, numero: 'CC-2026-002' }),
      ])
      const r = await service.list(T, { pagina: 1, dimensione: 20 })
      expect(r.elementi.map(e => e.numero)).toEqual(['CC-2026-001', 'CC-2026-002'])
      expect(tx.contrattoCliente.findMany).toHaveBeenCalledTimes(1)
    })
  })
})
