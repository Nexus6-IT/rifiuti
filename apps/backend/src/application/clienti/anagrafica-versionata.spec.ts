import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
} from './anagrafica-versionata'

const CONTO: DescrizioneEntita = {
  prefisso: 'CONTO_CORRENTE',
  soggetto: 'Il conto corrente',
  femminile: false,
}
const CONDIZIONE: DescrizioneEntita = {
  prefisso: 'CONDIZIONE_PAGAMENTO',
  soggetto: 'La condizione di pagamento',
  femminile: true,
}

const errorePrisma = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

async function eccezione(fn: () => unknown): Promise<ConflictException> {
  try {
    await fn()
  } catch (e) {
    return e as ConflictException
  }
  throw new Error('attesa un’eccezione')
}

describe('anagrafica-versionata', () => {
  describe('scriviCondizionato', () => {
    it('count 1: non lancia', async () => {
      await expect(scriviCondizionato(async () => ({ count: 1 }), CONTO)).resolves.toBeUndefined()
    })

    it('count 0: 409 col codice e il soggetto (maschile)', async () => {
      const e = await eccezione(() => scriviCondizionato(async () => ({ count: 0 }), CONTO))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toEqual({
        error: 'CONTO_CORRENTE_MODIFICATO_NEL_FRATTEMPO',
        message:
          "Il conto corrente è stato modificato nel frattempo da un'altra operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione.",
      })
    })

    it('count 0: accordo femminile del codice e del participio', async () => {
      const e = await eccezione(() => scriviCondizionato(async () => ({ count: 0 }), CONDIZIONE))
      expect((e.getResponse() as any).error).toBe('CONDIZIONE_PAGAMENTO_MODIFICATA_NEL_FRATTEMPO')
      expect((e.getResponse() as any).message).toContain(
        'La condizione di pagamento è stata modificata'
      )
    })
  })

  describe('confrontaVersione', () => {
    it('versione uguale: non lancia', () => {
      expect(() => confrontaVersione(3, 3, CONTO)).not.toThrow()
    })

    it('versione diversa: 409 modificato nel frattempo', async () => {
      const e = await eccezione(() => confrontaVersione(3, 2, CONTO))
      expect(e).toBeInstanceOf(ConflictException)
      expect((e.getResponse() as any).error).toBe('CONTO_CORRENTE_MODIFICATO_NEL_FRATTEMPO')
    })
  })

  describe('traduciErrorePrisma', () => {
    const vincoli = {
      conti_correnti_tenant_id_codice_key: {
        codice: 'CONTO_CORRENTE_CODICE_DUPLICATO',
        messaggio: 'Esiste già un conto corrente con questo codice.',
      },
      conti_correnti_tenant_id_iban_key: {
        codice: 'CONTO_CORRENTE_IBAN_DUPLICATO',
        messaggio: 'Esiste già un conto corrente con questo IBAN.',
      },
    }

    it('P2002 su un vincolo mappato (nome del vincolo): 409 col codice del vincolo', async () => {
      const e = await eccezione(() =>
        traduciErrorePrisma(
          errorePrisma('P2002', { target: 'conti_correnti_tenant_id_iban_key' }),
          CONTO,
          vincoli
        )
      )
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'CONTO_CORRENTE_IBAN_DUPLICATO',
        message: 'Esiste già un conto corrente con questo IBAN.',
      })
    })

    it('P2002 con target a colonne: riconosce il vincolo dal nome delle colonne', async () => {
      const e = await eccezione(() =>
        traduciErrorePrisma(
          errorePrisma('P2002', { target: ['tenant_id', 'iban'] }),
          CONTO,
          vincoli
        )
      )
      expect((e.getResponse() as any).error).toBe('CONTO_CORRENTE_IBAN_DUPLICATO')
    })

    it('P2002 senza target (RLS): con un solo vincolo noto lo usa, con più vincoli rilancia', async () => {
      const unico = {
        conti_correnti_tenant_id_codice_key: vincoli.conti_correnti_tenant_id_codice_key,
      }
      const e = await eccezione(() =>
        traduciErrorePrisma(errorePrisma('P2002', { target: null }), CONTO, unico)
      )
      expect((e.getResponse() as any).error).toBe('CONTO_CORRENTE_CODICE_DUPLICATO')
      const originale = errorePrisma('P2002', { target: null })
      expect(await eccezione(() => traduciErrorePrisma(originale, CONTO, vincoli))).toBe(originale)
    })

    it('P2002 senza target con più vincoli: usa il nome riletto da `rileggi`', async () => {
      const rileggi = jest.fn(async () => 'conti_correnti_tenant_id_iban_key')
      const e = await eccezione(() =>
        traduciErrorePrisma(errorePrisma('P2002', { target: null }), CONTO, vincoli, rileggi)
      )
      expect(rileggi).toHaveBeenCalledTimes(1)
      expect((e.getResponse() as any).error).toBe('CONTO_CORRENTE_IBAN_DUPLICATO')
    })

    it('P2002 senza target con più vincoli: se `rileggi` non sa dire, rilancia l’originale', async () => {
      const originale = errorePrisma('P2002', { target: null })
      const e = await eccezione(() =>
        traduciErrorePrisma(originale, CONTO, vincoli, async () => null)
      )
      expect(e).toBe(originale)
    })

    it('`rileggi` non si chiama se il target c’è o se il vincolo è uno solo', async () => {
      const rileggi = jest.fn(async () => 'conti_correnti_tenant_id_iban_key')
      await eccezione(() =>
        traduciErrorePrisma(
          errorePrisma('P2002', { target: ['tenant_id', 'codice'] }),
          CONTO,
          vincoli,
          rileggi
        )
      )
      const unico = {
        conti_correnti_tenant_id_codice_key: vincoli.conti_correnti_tenant_id_codice_key,
      }
      await eccezione(() =>
        traduciErrorePrisma(errorePrisma('P2002', { target: null }), CONTO, unico, rileggi)
      )
      expect(rileggi).not.toHaveBeenCalled()
    })

    it('P2002 non mappato: rilancia l’errore originale', async () => {
      const originale = errorePrisma('P2002', { target: 'altro_vincolo_key' })
      const e = await eccezione(() => traduciErrorePrisma(originale, CONTO, vincoli))
      expect(e).toBe(originale)
    })

    it('P2003: 409 <PREFISSO>_IN_USO con il participio del genere', async () => {
      const m = await eccezione(() => traduciErrorePrisma(errorePrisma('P2003'), CONTO, vincoli))
      expect(m.getResponse()).toMatchObject({
        error: 'CONTO_CORRENTE_IN_USO',
        message:
          'Il conto corrente è usato da clienti o contratti: disattivalo invece di eliminarlo.',
      })
      const f = await eccezione(() =>
        traduciErrorePrisma(errorePrisma('P2003'), CONDIZIONE, vincoli)
      )
      expect((f.getResponse() as any).message).toContain('La condizione di pagamento è usata')
      expect((f.getResponse() as any).error).toBe('CONDIZIONE_PAGAMENTO_IN_USO')
    })

    it('P2003 di un\'entità femminile: "disattivala invece di eliminarla" (accordo di genere)', async () => {
      const f = await eccezione(() =>
        traduciErrorePrisma(errorePrisma('P2003'), CONDIZIONE, vincoli)
      )
      expect((f.getResponse() as any).message).toBe(
        'La condizione di pagamento è usata da clienti o contratti: disattivala invece di eliminarla.'
      )
    })

    it("P2003 con `inUso`: codice e messaggio dell'entità sostituiscono quelli di ripiego", async () => {
      const agente = {
        prefisso: 'AGENTE',
        soggetto: "L'agente",
        femminile: false,
        inUso: {
          codice: 'AGENTE_IN_USO',
          messaggio:
            "L'agente è indicato su clienti o contratti: disattivalo invece di eliminarlo.",
        },
      }
      const m = await eccezione(() => traduciErrorePrisma(errorePrisma('P2003'), agente, vincoli))
      expect(m).toBeInstanceOf(ConflictException)
      expect(m.getResponse()).toMatchObject({
        error: 'AGENTE_IN_USO',
        message: "L'agente è indicato su clienti o contratti: disattivalo invece di eliminarlo.",
      })
    })

    it.each([
      ['P2028', errorePrisma('P2028')],
      ['P2034', errorePrisma('P2034')],
      ['40P01 (deadlock dal raw)', errorePrisma('P2010', { code: '40P01' })],
      ['55P03 (lock timeout dal raw)', errorePrisma('P2010', { code: '55P03' })],
    ])('%s: 409 in italiano con "riprova", mai un 500', async (_nome, errore) => {
      const m = await eccezione(() => traduciErrorePrisma(errore, CONTO, vincoli))
      expect(m).toBeInstanceOf(ConflictException)
      expect(m.getResponse()).toEqual({
        error: 'OPERAZIONE_CONCORRENTE',
        message: "L'operazione è stata interrotta da un'altra in corso: riprova.",
      })
    })

    it('un P2010 con altro codice resta un errore da rilanciare', async () => {
      const originale = errorePrisma('P2010', { code: '23514' })
      const e = await eccezione(() => traduciErrorePrisma(originale, CONTO, vincoli))
      expect(e).toBe(originale)
    })

    it('un errore qualunque viene rilanciato così com’è', async () => {
      const originale = new Error('boom')
      const e = await eccezione(() => traduciErrorePrisma(originale, CONTO, vincoli))
      expect(e).toBe(originale)
    })
  })
})
