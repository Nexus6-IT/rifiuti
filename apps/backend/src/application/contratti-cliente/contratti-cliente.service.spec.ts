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
    dittaId: D,
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
  /** Numero di righe non T del contratto (D17). */
  let righeNonT: number

  beforeEach(() => {
    controlla.mockReset().mockResolvedValue([])
    sedi = [{ id: S }]
    principali = []
    righeNonT = 0
    tx = {
      contrattoCliente: {
        create: jest.fn().mockResolvedValue({ id: K }),
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      codificaContratto: {
        findFirst: jest.fn().mockResolvedValue({ descrizione: 'Cessata attività' }),
      },
      documentoFattura: { count: jest.fn().mockResolvedValue(0) },
      periodoFatturazioneCliente: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn(async (strings: readonly string[]) => {
        const testo = strings.join('?')
        if (testo.includes('righe_addebito')) return [{ n: righeNonT }]
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

    it('se il corpo cambia solo il codice, il riferimento del cliente si eredita comunque (D4, I2)', async () => {
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
      expect(data.riferimentoAmministrazione).toBe('RIF')
    })

    it.each([[null], ['0000000']])(
      'codice effettivo %s: il riferimento del cliente non si eredita (I2)',
      async codice => {
        clienti.attiviPerId.mockResolvedValue(
          new Map([
            [
              CL,
              clienteEreditabile({
                codiceDestinatario: 'UFE1AB',
                riferimentoAmministrazione: 'RIF',
              }),
            ],
          ])
        )
        await service.crea(T, U, { ...base, codiceDestinatario: codice })
        const data = tx.contrattoCliente.create.mock.calls[0][0].data
        expect(data.riferimentoAmministrazione ?? null).toBeNull()
      }
    )

    it('corpo con solo il riferimento: il codice si eredita e la validazione pura non lo rifiuta (I1)', async () => {
      clienti.attiviPerId.mockResolvedValue(
        new Map([[CL, clienteEreditabile({ codiceDestinatario: 'UFE1AB' })]])
      )
      await service.crea(T, U, { ...base, riferimentoAmministrazione: 'RIF-NUOVO' })
      const data = tx.contrattoCliente.create.mock.calls[0][0].data
      expect(data.codiceDestinatario).toBe('UFE1AB')
      expect(data.riferimentoAmministrazione).toBe('RIF-NUOVO')
    })

    it('corpo con solo il riferimento e cliente senza codice: 400 dopo l’ereditarieta’ (I1)', async () => {
      clienti.attiviPerId.mockResolvedValue(
        new Map([[CL, clienteEreditabile({ codiceDestinatario: null })]])
      )
      const e = await errore(service.crea(T, U, { ...base, riferimentoAmministrazione: 'RIF' }))
      expect(e.getResponse().message).toContain(
        'Il riferimento amministrazione si indica solo insieme al codice destinatario.'
      )
    })

    describe('predefiniti disattivati (R42)', () => {
      const soloChiavi = (r: Record<string, unknown>, ...k: string[]) =>
        Object.keys(r).length === k.length && k.every(x => x in r)

      it('predefinito ereditato disattivato: 400 con il messaggio dedicato, mai null in silenzio', async () => {
        controlla.mockImplementation(
          async (_tx: unknown, _t: string, r: Record<string, unknown>) =>
            soloChiavi(r, 'condizionePagamentoId')
              ? ['La condizione di pagamento scelta non esiste o è disattivata.']
              : []
        )
        const e = await errore(service.crea(T, U, base))
        expect(e.getResponse().message).toEqual([
          "La condizione di pagamento predefinita del cliente è disattivata: scegline un'altra o lascia il campo vuoto.",
        ])
        expect(tx.contrattoCliente.create).not.toHaveBeenCalled()
      })

      it('scelto dall’operatore e disattivato: resta il messaggio generico', async () => {
        controlla.mockImplementation(
          async (_tx: unknown, _t: string, r: Record<string, unknown>) =>
            r.condizionePagamentoId === R(7)
              ? ['La condizione di pagamento scelta non esiste o è disattivata.']
              : []
        )
        const e = await errore(service.crea(T, U, { ...base, condizionePagamentoId: R(7) }))
        expect(e.getResponse().message).toEqual([
          'La condizione di pagamento scelta non esiste o è disattivata.',
        ])
      })

      it('null esplicito sul predefinito disattivato: la creazione riesce', async () => {
        controlla.mockImplementation(
          async (_tx: unknown, _t: string, r: Record<string, unknown>) =>
            r.condizionePagamentoId ? ['x'] : []
        )
        await service.crea(T, U, { ...base, condizionePagamentoId: null })
        expect(tx.contrattoCliente.create).toHaveBeenCalled()
      })
    })

    it('cliente disattivato: solo l’errore del cliente, nessun controllo sui predefiniti (M3)', async () => {
      clienti.attiviPerId.mockResolvedValue(new Map([[CL, clienteEreditabile({ attivo: false })]]))
      controlla.mockResolvedValue(['Messaggio dei predefiniti'])
      const e = await errore(service.crea(T, U, base))
      expect(e.getResponse().message).toEqual(['Il cliente scelto non esiste o è disattivato.'])
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
      controlla.mockImplementation(async (_tx: unknown, _t: string, r: Record<string, unknown>) =>
        r.categoriaId ? ['La condizione di pagamento scelta non esiste o è disattivata.'] : []
      )
      const e = await errore(service.crea(T, U, { ...base, categoriaId: R(8) }))
      expect(e.getResponse().message).toEqual([
        'La condizione di pagamento scelta non esiste o è disattivata.',
      ])
      const passati = controlla.mock.calls[0][2]
      expect(passati.categoriaId).toBe(R(8))
      // gli ereditati si controllano a parte, un campo per volta (R42)
      expect(passati.condizionePagamentoId).toBeUndefined()
      expect(controlla.mock.calls.some(c => c[2].condizionePagamentoId === R(2))).toBe(true)
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

    it('ordina per creazione, non per numero testuale (M6)', async () => {
      await service.list(T, { pagina: 1, dimensione: 20 })
      expect(tx.contrattoCliente.findMany.mock.calls[0][0].orderBy).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ])
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

  describe('modifica (Task 17)', () => {
    const MOD = 'Contratto modificato'

    it('annullato con versione sbagliata: "non modificabile", non "modificato nel frattempo" (D14)', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ stato: 'ANNULLATO', versione: 4 }))
      const e = await errore(service.modifica(T, U, K, { descrizione: MOD, versione: 1 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_MODIFICABILE')
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('contratto inesistente, eliminato o con id non valido: 404', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect(
        await errore(service.modifica(T, U, K, { descrizione: MOD, versione: 1 }))
      ).toBeInstanceOf(NotFoundException)
      expect(
        await errore(service.modifica(T, U, 'x', { descrizione: MOD, versione: 1 }))
      ).toBeInstanceOf(NotFoundException)
    })

    it('la riga si legge solo se non eliminata e dopo il lock FOR UPDATE', async () => {
      await service.modifica(T, U, K, { descrizione: MOD, versione: 1 })
      expect(tx.contrattoCliente.findFirst.mock.calls[0][0].where).toEqual({
        id: K,
        tenantId: T,
        eliminatoIl: null,
      })
      const lock = tx.$queryRaw.mock.calls.find((c: any[]) => c[0].join('?').includes('FOR UPDATE'))
      expect(lock).toBeDefined()
    })

    it('versione diversa: 409 MODIFICATO_NEL_FRATTEMPO e nessuna scrittura', async () => {
      const e = await errore(service.modifica(T, U, K, { descrizione: MOD, versione: 7 }))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('campi non ammessi in ATTIVO: 409 CONTRATTO_CLIENTE_CAMPI_NON_AMMESSI', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ stato: 'ATTIVO' }))
      const e = await errore(service.modifica(T, U, K, { numero: 'CC-9', versione: 1 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_CAMPI_NON_AMMESSI')
      expect(e.getResponse().message).toContain('Numero')
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('nessuna modifica: niente scritture, niente audit, ma la versione si controlla', async () => {
      const v = await service.modifica(T, U, K, { descrizione: 'Contratto di prova', versione: 1 })
      expect(v.id).toBe(K)
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
      const e = await errore(
        service.modifica(T, U, K, { descrizione: 'Contratto di prova', versione: 3 })
      )
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('validazione pura: 400 con i messaggi, nessuna scrittura', async () => {
      const e = await errore(service.modifica(T, U, K, { descrizione: null, versione: 1 }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_VALIDO')
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('scrive condizionato a id, azienda, versione, stato e non eliminato; versione + 1', async () => {
      await service.modifica(T, U, K, { descrizione: MOD, dataFine: null, versione: 1 })
      const arg = tx.contrattoCliente.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        id: K,
        tenantId: T,
        versione: 1,
        stato: 'BOZZA',
        eliminatoIl: null,
      })
      expect(arg.data).toEqual({ descrizione: MOD, dataFine: null, versione: { increment: 1 } })
      expect(tx.periodoFatturazioneCliente.deleteMany).not.toHaveBeenCalled()
    })

    it('periodi cambiati: deleteMany + createMany dopo l’updateMany riuscito', async () => {
      const periodi = [{ giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 }]
      await service.modifica(T, U, K, { periodi, versione: 1 })
      const um = tx.contrattoCliente.updateMany.mock.invocationCallOrder[0]
      const del = tx.periodoFatturazioneCliente.deleteMany.mock.invocationCallOrder[0]
      const cre = tx.periodoFatturazioneCliente.createMany.mock.invocationCallOrder[0]
      expect(um).toBeLessThan(del)
      expect(del).toBeLessThan(cre)
      expect(tx.periodoFatturazioneCliente.deleteMany.mock.calls[0][0].where).toEqual({
        contrattoId: K,
        tenantId: T,
      })
      expect(tx.periodoFatturazioneCliente.createMany.mock.calls[0][0].data).toEqual([
        {
          tenantId: T,
          contrattoId: K,
          ordine: 1,
          giornoInizio: 1,
          meseInizio: 1,
          giornoFine: 30,
          meseFine: 6,
        },
      ])
      expect(tx.contrattoCliente.updateMany.mock.calls[0][0].data).toEqual({
        versione: { increment: 1 },
      })
    })

    it('periodi svuotati con null: si cancellano, nessun createMany', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(
        riga({
          periodi: [{ ordine: 1, giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 }],
        })
      )
      await service.modifica(T, U, K, { periodi: null, versione: 1 })
      expect(tx.periodoFatturazioneCliente.deleteMany).toHaveBeenCalledTimes(1)
      expect(tx.periodoFatturazioneCliente.createMany).not.toHaveBeenCalled()
    })

    it('updateMany con count 0: 409 e i periodi non si toccano', async () => {
      tx.contrattoCliente.updateMany.mockResolvedValue({ count: 0 })
      const periodi = [{ giornoInizio: 1, meseInizio: 1, giornoFine: 30, meseFine: 6 }]
      const e = await errore(service.modifica(T, U, K, { periodi, versione: 1 }))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.periodoFatturazioneCliente.deleteMany).not.toHaveBeenCalled()
      expect(tx.periodoFatturazioneCliente.createMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('cliente di fatturazione disattivato: 400', async () => {
      clienti.attiviPerId.mockResolvedValue(
        new Map([[CF, clienteEreditabile({ id: CF, attivo: false })]])
      )
      const e = await errore(service.modifica(T, U, K, { clienteFatturazioneId: CF, versione: 1 }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toEqual([
        'Il cliente di fatturazione scelto non esiste o è disattivato.',
      ])
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    describe('recapito SDI al cambio del cliente di fatturazione (R44)', () => {
      it('nuovo cliente di fatturazione senza valori nel corpo: codice e riferimento dal nuovo', async () => {
        await service.modifica(T, U, K, { clienteFatturazioneId: CF, versione: 1 })
        const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
        expect(data.clienteFatturazioneId).toBe(CF)
        expect(data.codiceDestinatario).toBe('UFE1AB')
        expect(data.riferimentoAmministrazione).toBe('RIF-PA')
      })

      it('i valori scritti nel corpo vincono', async () => {
        await service.modifica(T, U, K, {
          clienteFatturazioneId: CF,
          codiceDestinatario: 'ZZZZZZZ',
          riferimentoAmministrazione: 'MIO-RIF',
          versione: 1,
        })
        const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
        expect(data.codiceDestinatario).toBe('ZZZZZZZ')
        expect(data.riferimentoAmministrazione).toBe('MIO-RIF')
      })

      it('corpo col solo codice 0000000: il riferimento del nuovo intestatario non si porta dietro', async () => {
        await service.modifica(T, U, K, {
          clienteFatturazioneId: CF,
          codiceDestinatario: '0000000',
          versione: 1,
        })
        const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
        expect(data.codiceDestinatario).toBe('0000000')
        expect(data.riferimentoAmministrazione ?? null).toBeNull()
      })

      it('fatturazione tolta (null): il recapito torna quello del cliente', async () => {
        tx.contrattoCliente.findFirst.mockResolvedValue(
          riga({
            clienteFatturazioneId: CF,
            codiceDestinatario: 'UFE1AB',
            riferimentoAmministrazione: 'RIF-PA',
          })
        )
        await service.modifica(T, U, K, { clienteFatturazioneId: null, versione: 1 })
        const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
        expect(data.clienteFatturazioneId).toBeNull()
        expect(data.codiceDestinatario).toBe('ABCDEFG')
        expect(data.riferimentoAmministrazione).toBeNull()
      })

      it('fatturazione invariata: il recapito del contratto non si tocca', async () => {
        tx.contrattoCliente.findFirst.mockResolvedValue(
          riga({ clienteFatturazioneId: CF, codiceDestinatario: 'MANUALE' })
        )
        await service.modifica(T, U, K, {
          clienteFatturazioneId: CF,
          descrizione: MOD,
          versione: 1,
        })
        const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
        expect(data.codiceDestinatario).toBeUndefined()
      })
    })

    it('bollo verso una spesa di incasso: 400 col messaggio del controllo', async () => {
      controlla.mockResolvedValue([
        'La spesa di bollo scelta non esiste, è disattivata o non è una spesa di bollo.',
      ])
      const e = await errore(service.modifica(T, U, K, { bolloId: R(6), versione: 1 }))
      expect(e.getResponse().message).toEqual([
        'La spesa di bollo scelta non esiste, è disattivata o non è una spesa di bollo.',
      ])
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('si controllano solo i riferimenti cambiati', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(
        riga({ condizionePagamentoId: R(2), registroIvaId: R(4) })
      )
      await service.modifica(T, U, K, {
        condizionePagamentoId: R(2),
        registroIvaId: R(7),
        descrizione: MOD,
        versione: 1,
      })
      expect(controlla).toHaveBeenCalledTimes(1)
      expect(controlla.mock.calls[0][2]).toEqual({ registroIvaId: R(7) })
      expect(clienti.attiviPerId).not.toHaveBeenCalled()
    })

    it('solo descrizione cambiata: nessun controllo sui riferimenti', async () => {
      await service.modifica(T, U, K, { descrizione: MOD, versione: 1 })
      expect(controlla).not.toHaveBeenCalled()
      expect(clienti.attiviPerId).not.toHaveBeenCalled()
    })

    it('sede non della ditta del cliente: 400', async () => {
      sedi = []
      const e = await errore(service.modifica(T, U, K, { sedeId: S, versione: 1 }))
      expect(e.getResponse().message).toEqual(['La sede scelta non è una sede attiva del cliente.'])
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
      const MSG =
        'Il contratto principale deve essere un contratto dello stesso cliente, non annullato e non allegato a sua volta.'

      it('principale valido: bloccato con FOR UPDATE e scritto', async () => {
        principali = [principale()]
        await service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 })
        const lock = tx.$queryRaw.mock.calls.filter((c: any[]) =>
          c[0].join('?').includes('FOR UPDATE')
        )
        expect(lock.length).toBeGreaterThanOrEqual(2)
        expect(tx.contrattoCliente.updateMany.mock.calls[0][0].data.contrattoPrincipaleId).toBe(P)
      })

      it('principale che ha questo contratto come principale (o già allegato): 400', async () => {
        principali = [principale({ contrattoPrincipaleId: K })]
        const e = await errore(service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 }))
        expect(e.getResponse().message).toEqual([MSG])
        expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
      })

      it.each([
        ['di un altro cliente', { clienteId: CF }],
        ['annullato', { stato: 'ANNULLATO' }],
        ['eliminato', { eliminato: true }],
      ])('principale %s: 400', async (_n, extra) => {
        principali = [principale(extra)]
        const e = await errore(service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 }))
        expect(e.getResponse().message).toEqual([MSG])
      })

      it('principale inesistente: 400', async () => {
        principali = []
        const e = await errore(service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 }))
        expect(e.getResponse().message).toEqual([MSG])
      })

      it('un contratto che ha allegati non si allega: 400', async () => {
        principali = [principale()]
        tx.contrattoCliente.findFirst.mockResolvedValue(riga({ _count: { contrattiAllegati: 1 } }))
        const e = await errore(service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 }))
        expect(e.getResponse().message).toEqual([
          'Questo contratto ha dei contratti allegati: non può essere allegato a un altro.',
        ])
      })

      it('contratto con righe di tipo diverso da T: non si allega, 400 (D17)', async () => {
        principali = [principale()]
        righeNonT = 2
        const e = await errore(service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 }))
        expect(e.getResponse().message).toEqual([
          'Questo contratto ha addebiti di tipo diverso da T: non può essere allegato a un altro.',
        ])
        expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
        const q = tx.$queryRaw.mock.calls.find((c: any[]) =>
          c[0].join('?').includes('righe_addebito')
        )
        expect(q[0].join('?')).toContain('JOIN elenchi_addebiti')
        expect(q[0].join('?')).toContain("r.tipo !~ '^T'")
      })

      it('contratto con sole righe T (o senza righe): si allega', async () => {
        principali = [principale()]
        righeNonT = 0
        await service.modifica(T, U, K, { contrattoPrincipaleId: P, versione: 1 })
        expect(tx.contrattoCliente.updateMany).toHaveBeenCalled()
      })

      it('il controllo delle righe non scatta se non cambia il principale o lo si stacca', async () => {
        righeNonT = 3
        tx.contrattoCliente.findFirst.mockResolvedValue(riga({ contrattoPrincipaleId: P }))
        await service.modifica(T, U, K, { descrizione: 'Nuova', versione: 1 })
        await service.modifica(T, U, K, { contrattoPrincipaleId: null, versione: 1 })
        expect(
          tx.$queryRaw.mock.calls.some((c: any[]) => c[0].join('?').includes('righe_addebito'))
        ).toBe(false)
      })

      it('allegato a se stesso: 400 della regola pura, senza leggere il database', async () => {
        const e = await errore(service.modifica(T, U, K, { contrattoPrincipaleId: K, versione: 1 }))
        expect(e.getResponse().message).toEqual([
          'Un contratto non può essere allegato a sé stesso.',
        ])
      })

      it('principale svuotato con null: nessun controllo', async () => {
        tx.contrattoCliente.findFirst.mockResolvedValue(riga({ contrattoPrincipaleId: P }))
        await service.modifica(T, U, K, { contrattoPrincipaleId: null, versione: 1 })
        expect(
          tx.contrattoCliente.updateMany.mock.calls[0][0].data.contrattoPrincipaleId
        ).toBeNull()
      })

      it('cliente cambiato in bozza con allegati: 400', async () => {
        tx.contrattoCliente.findFirst.mockResolvedValue(riga({ _count: { contrattiAllegati: 2 } }))
        const e = await errore(service.modifica(T, U, K, { clienteId: CF, versione: 1 }))
        expect(e.getResponse().message).toContain(
          'Questo contratto ha dei contratti allegati: non se ne cambia il cliente.'
        )
      })
    })

    it('audit: nomi dei campi e valori ammessi, mai testo libero', async () => {
      await service.modifica(T, U, K, {
        descrizione: 'Dati riservati del contratto',
        dataFine: '2027-06-30',
        commessa: 'COMM-1',
        versione: 1,
      })
      const log = tx.activityLog.create.mock.calls[0][0].data
      expect(log.action).toBe('CONTRATTO_CLIENTE_MODIFICATO')
      expect(log.description).toBe('Contratto CC-2026-001 modificato')
      expect(log.metadata.campi).toEqual(['descrizione', 'dataFine', 'commessa'])
      expect(log.metadata.prima).toEqual({ dataFine: '2026-12-31' })
      expect(log.metadata.dopo).toEqual({ dataFine: '2027-06-30' })
      expect(JSON.stringify(log)).not.toContain('Dati riservati')
      expect(JSON.stringify(log)).not.toContain('COMM-1')
    })

    it('P2002 sul numero: 409 CONTRATTO_CLIENTE_NUMERO_DUPLICATO', async () => {
      tx.contrattoCliente.updateMany.mockRejectedValue(errP('P2002'))
      const e = await errore(service.modifica(T, U, K, { numero: 'CC-2026-009', versione: 1 }))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NUMERO_DUPLICATO')
    })

    it('deadlock fra due allegamenti incrociati: 409 MODIFICATO_NEL_FRATTEMPO', async () => {
      tx.contrattoCliente.updateMany.mockRejectedValue(errP('P2034'))
      const e = await errore(service.modifica(T, U, K, { descrizione: MOD, versione: 1 }))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('id in maiuscolo dall’URL: "allegato a sé stesso" si riconosce (400, non CHECK del database)', async () => {
      const e = await errore(
        service.modifica(T, U, K.toUpperCase(), { contrattoPrincipaleId: K, versione: 1 })
      )
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toEqual(['Un contratto non può essere allegato a sé stesso.'])
    })

    it('deadlock dal raw (P2010 con meta.code 40P01): 409 MODIFICATO_NEL_FRATTEMPO', async () => {
      tx.contrattoCliente.updateMany.mockRejectedValue(errP('P2010', { code: '40P01' }))
      const e = await errore(service.modifica(T, U, K, { descrizione: MOD, versione: 1 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('risponde con la vista riletta', async () => {
      tx.contrattoCliente.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: MOD, versione: 2 }))
      const v = await service.modifica(T, U, K, { descrizione: MOD, versione: 1 })
      expect(v.descrizione).toBe(MOD)
      expect(v.versione).toBe(2)
    })
  })

  describe('cambiaStato (Task 17)', () => {
    const attivo = (extra: Record<string, unknown> = {}) =>
      riga({ stato: 'ATTIVO', condizionePagamentoId: R(2), registroIvaId: R(4), ...extra })

    it('transizione non ammessa: 409, anche con la versione sbagliata (D14)', async () => {
      const e = await errore(service.cambiaStato(T, U, K, 'SOSPESO', 9))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_TRANSIZIONE_NON_AMMESSA')
      expect(e.getResponse().message).toBe('Dallo stato Bozza non si passa a Sospeso.')
    })

    it('da annullato non si passa a nessuno stato: 409', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ stato: 'ANNULLATO' }))
      const e = await errore(service.cambiaStato(T, U, K, 'ATTIVO', 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_TRANSIZIONE_NON_AMMESSA')
    })

    it('contratto inesistente: 404', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect(await errore(service.cambiaStato(T, U, K, 'ATTIVO', 1))).toBeInstanceOf(
        NotFoundException
      )
    })

    it('versione diversa: 409 MODIFICATO_NEL_FRATTEMPO', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      const e = await errore(service.cambiaStato(T, U, K, 'SOSPESO', 5))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('BOZZA → ATTIVO senza condizione di pagamento: 400', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ registroIvaId: R(4) }))
      const e = await errore(service.cambiaStato(T, U, K, 'ATTIVO', 1))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toEqual([
        'Per attivare il contratto indica la condizione di pagamento.',
      ])
    })

    it('BOZZA → ATTIVO senza registro IVA: 400', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ condizionePagamentoId: R(2) }))
      const e = await errore(service.cambiaStato(T, U, K, 'ATTIVO', 1))
      expect(e.getResponse().message).toEqual(['Per attivare il contratto indica il registro IVA.'])
    })

    it('BOZZA → ATTIVO: scrittura condizionata allo stato di partenza, audit senza dati', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(
        riga({ condizionePagamentoId: R(2), registroIvaId: R(4) })
      )
      await service.cambiaStato(T, U, K, 'ATTIVO', 1)
      const arg = tx.contrattoCliente.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        id: K,
        tenantId: T,
        versione: 1,
        stato: 'BOZZA',
        eliminatoIl: null,
      })
      expect(arg.data).toEqual({ stato: 'ATTIVO', versione: { increment: 1 } })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'CONTRATTO_CLIENTE_STATO',
        metadata: { contrattoId: K, da: 'BOZZA', a: 'ATTIVO' },
      })
    })

    it('updateMany con count 0: 409', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      tx.contrattoCliente.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.cambiaStato(T, U, K, 'SOSPESO', 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('annullo senza motivo né codice: 400', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      const e = await errore(service.cambiaStato(T, U, K, 'ANNULLATO', 1, { motivo: '  ' }))
      expect(e.getResponse().message).toEqual(["Indica il motivo dell'annullo."])
    })

    it('annullo col solo codice: motivo_annullo = descrizione della codifica', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      await service.cambiaStato(T, U, K, 'ANNULLATO', 1, { motivoAnnulloId: R(8) })
      expect(controlla.mock.calls[0][2]).toEqual({ motivoAnnulloId: R(8) })
      const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
      expect(data).toMatchObject({
        stato: 'ANNULLATO',
        motivoAnnulloId: R(8),
        motivoAnnullo: 'Cessata attività',
        versione: { increment: 1 },
      })
      expect(data.annullatoIl).toEqual(OGGI)
    })

    it('annullo col solo testo: nessun codice, nessuna lettura della codifica', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      await service.cambiaStato(T, U, K, 'ANNULLATO', 1, { motivo: '  Disdetta del cliente ' })
      const data = tx.contrattoCliente.updateMany.mock.calls[0][0].data
      expect(data.motivoAnnullo).toBe('Disdetta del cliente')
      expect(data.motivoAnnulloId).toBeNull()
      expect(controlla).not.toHaveBeenCalled()
      expect(tx.codificaContratto.findFirst).not.toHaveBeenCalled()
    })

    it('annullo con codice e testo: vince il testo; audit senza il testo', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      await service.cambiaStato(T, U, K, 'ANNULLATO', 1, {
        motivoAnnulloId: R(8),
        motivo: 'Dettaglio riservato',
      })
      expect(tx.contrattoCliente.updateMany.mock.calls[0][0].data.motivoAnnullo).toBe(
        'Dettaglio riservato'
      )
      const log = tx.activityLog.create.mock.calls[0][0].data
      expect(log.metadata).toEqual({
        contrattoId: K,
        da: 'ATTIVO',
        a: 'ANNULLATO',
        motivoAnnulloId: R(8),
      })
      expect(JSON.stringify(log)).not.toContain('Dettaglio riservato')
    })

    it('annullo con codice disattivato o di altro genere: 400', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      controlla.mockResolvedValue(['Il motivo di annullo scelto non esiste o è disattivato.'])
      const e = await errore(
        service.cambiaStato(T, U, K, 'ANNULLATO', 1, { motivoAnnulloId: R(8) })
      )
      expect(e.getResponse().message).toEqual([
        'Il motivo di annullo scelto non esiste o è disattivato.',
      ])
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('motivo oltre 255 caratteri: 400 prima di leggere la codifica (D14)', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      const e = await errore(
        service.cambiaStato(T, U, K, 'ANNULLATO', 1, {
          motivoAnnulloId: R(8),
          motivo: 'x'.repeat(256),
        })
      )
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toEqual([
        "Il motivo dell'annullo non può superare 255 caratteri.",
      ])
      expect(controlla).not.toHaveBeenCalled()
      expect(tx.codificaContratto.findFirst).not.toHaveBeenCalled()
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('le transizioni senza annullo non scrivono motivo né data di annullo', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      await service.cambiaStato(T, U, K, 'SOSPESO_MOVIMENTI', 1, { motivo: 'ignorato' })
      expect(tx.contrattoCliente.updateMany.mock.calls[0][0].data).toEqual({
        stato: 'SOSPESO_MOVIMENTI',
        versione: { increment: 1 },
      })
    })
  })

  describe('elimina (Task 17)', () => {
    it('fuori da BOZZA: 409 NON_ELIMINABILE, anche con la versione sbagliata', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ stato: 'ATTIVO' }))
      const e = await errore(service.elimina(T, U, K, 9))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_ELIMINABILE')
      expect(e.getResponse().message).toBe(
        'Si eliminano solo i contratti in bozza: per chiudere questo contratto annullalo.'
      )
    })

    it('bozza con contratti allegati: 409 CONTRATTO_CLIENTE_CON_ALLEGATI', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ _count: { contrattiAllegati: 1 } }))
      const e = await errore(service.elimina(T, U, K, 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_CON_ALLEGATI')
      expect(e.getResponse().message).toBe(
        'Il contratto ha dei contratti allegati: staccali prima di eliminarlo.'
      )
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('bozza citata da un documento di fattura: 409 NON_ELIMINABILE, nessuna scrittura (4.4a)', async () => {
      tx.documentoFattura.count.mockResolvedValue(1)
      const e = await errore(service.elimina(T, U, K, 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_ELIMINABILE')
      expect(tx.documentoFattura.count).toHaveBeenCalledWith({
        where: { tenantId: T, contrattoId: K },
      })
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('inesistente: 404; versione diversa: 409', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, K, 1))).toBeInstanceOf(NotFoundException)
      tx.contrattoCliente.findFirst.mockResolvedValue(riga())
      const e = await errore(service.elimina(T, U, K, 2))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('eliminazione logica con condizione sullo stato BOZZA e audit', async () => {
      await service.elimina(T, U, K, 1)
      const arg = tx.contrattoCliente.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        id: K,
        tenantId: T,
        versione: 1,
        stato: 'BOZZA',
        eliminatoIl: null,
      })
      expect(arg.data.eliminatoIl).toEqual(OGGI)
      expect(arg.data.eliminatoDa).toBe(U)
      expect(arg.data.versione).toEqual({ increment: 1 })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'CONTRATTO_CLIENTE_ELIMINATO',
        metadata: { contrattoId: K, numero: 'CC-2026-001' },
      })
    })

    it('updateMany con count 0: 409 e niente audit', async () => {
      tx.contrattoCliente.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.elimina(T, U, K, 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })
  })

  describe('rinnova (Task 18, D11)', () => {
    const attivo = (extra: Record<string, unknown> = {}) =>
      riga({ stato: 'ATTIVO', dataFine: new Date('2026-12-31T00:00:00.000Z'), ...extra })

    it.each(['BOZZA', 'ANNULLATO'])('%s: 409 NON_RINNOVABILE col testo di D11', async stato => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ stato }))
      const e = await errore(service.rinnova(T, U, K, 1))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_RINNOVABILE')
      expect(e.getResponse().message).toBe(
        'Si rinnovano solo i contratti attivi o sospesi con una data di fine.'
      )
      expect(tx.contrattoCliente.updateMany).not.toHaveBeenCalled()
    })

    it('attivo senza data di fine: 409 NON_RINNOVABILE', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo({ dataFine: null }))
      const e = await errore(service.rinnova(T, U, K, 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_RINNOVABILE')
    })

    it('inesistente: 404; versione diversa: 409 MODIFICATO_NEL_FRATTEMPO', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect(await errore(service.rinnova(T, U, K, 1))).toBeInstanceOf(NotFoundException)
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      const e = await errore(service.rinnova(T, U, K, 7))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('non rinnovabile prima della versione sbagliata (D14)', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(riga({ stato: 'BOZZA' }))
      const e = await errore(service.rinnova(T, U, K, 9))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_NON_RINNOVABILE')
    })

    it('sposta la fine di un anno con scrittura condizionata, versione + 1 e audit prima/dopo', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      await service.rinnova(T, U, K, 1)
      const arg = tx.contrattoCliente.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        id: K,
        tenantId: T,
        versione: 1,
        stato: 'ATTIVO',
        eliminatoIl: null,
      })
      expect(arg.data).toEqual({
        dataFine: new Date('2027-12-31T00:00:00.000Z'),
        versione: { increment: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'CONTRATTO_CLIENTE_RINNOVATO',
        metadata: { contrattoId: K, dataFinePrima: '2026-12-31', dataFineDopo: '2027-12-31' },
      })
    })

    it('29/02/2024 diventa 28/02/2025', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(
        attivo({ dataFine: new Date('2024-02-29T00:00:00.000Z') })
      )
      await service.rinnova(T, U, K, 1)
      expect(tx.contrattoCliente.updateMany.mock.calls[0][0].data.dataFine).toEqual(
        new Date('2025-02-28T00:00:00.000Z')
      )
    })

    it('un contratto sospeso si rinnova', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo({ stato: 'SOSPESO' }))
      await service.rinnova(T, U, K, 1)
      expect(tx.contrattoCliente.updateMany.mock.calls[0][0].where.stato).toBe('SOSPESO')
    })

    it('updateMany con count 0: 409 e niente audit', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(attivo())
      tx.contrattoCliente.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.rinnova(T, U, K, 1))
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })
  })

  describe('prorogaScadenze (Task 18, D11)', () => {
    const filtri = {
      scadutiEntro: '2026-12-31',
      soloRinnovoAutomatico: true,
      ancheSospesi: false,
    }
    /** Il Prisma.Sql passato a `$executeRaw`: testo con i segnaposto e valori. */
    const sqlEseguito = () => {
      const q = tx.$executeRaw.mock.calls[0][0]
      return { testo: (q.strings as string[]).join('?'), valori: q.values as unknown[] }
    }

    it('esegue un solo $executeRaw nella transazione, con tenant, non eliminati e data', async () => {
      tx.$executeRaw.mockResolvedValue(3)
      const r = await service.prorogaScadenze(T, U, filtri)
      expect(r).toEqual({ prorogati: 3 })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      const { testo, valori } = sqlEseguito()
      expect(testo).toContain("data_fine = (data_fine + interval '1 year')::date")
      expect(testo).toContain('versione = versione + 1')
      expect(testo).toContain('updated_at = now()')
      expect(testo).toMatch(/tenant_id = \?::uuid/)
      expect(testo).toContain('eliminato_il IS NULL')
      expect(testo).toContain('data_fine IS NOT NULL')
      expect(testo).toMatch(/data_fine <= \?::date/)
      expect(testo).toContain('AND rinnovo_automatico')
      expect(valori[0]).toBe(T)
      expect(valori).toContain('2026-12-31')
    })

    it('stati: solo ATTIVO per default; con ancheSospesi anche i due sospesi; mai bozze o annullati', async () => {
      await service.prorogaScadenze(T, U, filtri)
      let { valori } = sqlEseguito()
      expect(valori).toContain('ATTIVO')
      expect(valori).not.toContain('SOSPESO')
      expect(valori).not.toContain('SOSPESO_MOVIMENTI')
      tx.$executeRaw.mockClear()
      await service.prorogaScadenze(T, U, { ...filtri, ancheSospesi: true })
      ;({ valori } = sqlEseguito())
      expect(valori).toEqual(expect.arrayContaining(['ATTIVO', 'SOSPESO', 'SOSPESO_MOVIMENTI']))
      expect(valori).not.toContain('BOZZA')
      expect(valori).not.toContain('ANNULLATO')
    })

    it('senza soloRinnovoAutomatico la condizione sul flag manca', async () => {
      await service.prorogaScadenze(T, U, { ...filtri, soloRinnovoAutomatico: false })
      expect(sqlEseguito().testo).not.toContain('rinnovo_automatico')
    })

    it('cliente e categoria entrano nel WHERE solo se indicati, come parametri', async () => {
      await service.prorogaScadenze(T, U, filtri)
      expect(sqlEseguito().testo).not.toContain('cliente_id')
      expect(sqlEseguito().testo).not.toContain('categoria_id')
      tx.$executeRaw.mockClear()
      await service.prorogaScadenze(T, U, { ...filtri, clienteId: CL, categoriaId: K })
      const { testo, valori } = sqlEseguito()
      expect(testo).toMatch(/cliente_id = \?::uuid/)
      expect(testo).toMatch(/categoria_id = \?::uuid/)
      expect(valori).toEqual(expect.arrayContaining([CL, K]))
    })

    it('audit unico CONTRATTO_CLIENTE_PROROGATI con conteggio e filtri', async () => {
      tx.$executeRaw.mockResolvedValue(2)
      await service.prorogaScadenze(T, U, { ...filtri, categoriaId: K })
      expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        userId: U,
        action: 'CONTRATTO_CLIENTE_PROROGATI',
        metadata: {
          prorogati: 2,
          filtri: { ...filtri, categoriaId: K },
        },
      })
    })

    it('deadlock o lock timeout durante la proroga: 409 MODIFICATO_NEL_FRATTEMPO, non 500', async () => {
      tx.$executeRaw.mockRejectedValue(errP('P2010', { code: '40P01' }))
      const e = await errore(service.prorogaScadenze(T, U, filtri))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTRATTO_CLIENTE_MODIFICATO_NEL_FRATTEMPO')
      tx.$executeRaw.mockRejectedValue(errP('P2034'))
      const e2 = await errore(service.prorogaScadenze(T, U, filtri))
      expect(e2).toBeInstanceOf(ConflictException)
    })

    it('zero prorogati: nessun audit', async () => {
      tx.$executeRaw.mockResolvedValue(0)
      expect(await service.prorogaScadenze(T, U, filtri)).toEqual({ prorogati: 0 })
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it.each(['2026-02-30', '31/12/2026', '', '2026-13-01'])(
      'data %p non valida: 400 senza toccare il database',
      async scadutiEntro => {
        const e = await errore(service.prorogaScadenze(T, U, { ...filtri, scadutiEntro }))
        expect(e).toBeInstanceOf(BadRequestException)
        expect(tx.$executeRaw).not.toHaveBeenCalled()
      }
    )

    it('id non UUID: 400 senza toccare il database', async () => {
      const e = await errore(service.prorogaScadenze(T, U, { ...filtri, clienteId: 'x' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(tx.$executeRaw).not.toHaveBeenCalled()
    })
  })
})
