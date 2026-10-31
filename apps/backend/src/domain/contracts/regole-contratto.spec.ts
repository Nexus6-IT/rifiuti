import {
  CAMPI_MODIFICABILI,
  ETICHETTE_CAMPI,
  STATI_ELIMINABILI,
  ContractStatus,
  DatiContratto,
  motivoNonEliminabile,
  motivoNonModificabile,
  normalizzaDati,
  pianificaModifica,
  validaDatiContratto,
} from './regole-contratto'

const bozza = (extra: Partial<DatiContratto> = {}): DatiContratto => ({
  contractNumber: 'CTR-2026-001',
  producerId: 'p1',
  counterpartyId: 'c1',
  counterpartyType: 'TRANSPORTER',
  contractType: 'WASTE_TRANSPORT',
  description: 'Descrizione',
  cerCodes: ['150101', '150102'],
  pricingModel: 'FLAT_RATE',
  basePrice: 120.5,
  unitOfMeasure: 'kg',
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-12-31T00:00:00Z'),
  durationMonths: 12,
  autoRenew: false,
  renewalNoticeDays: 60,
  paymentTerms: 'net_30',
  billingFrequency: 'monthly',
  ...extra,
})

describe('regole del contratto', () => {
  it('CAMPI_MODIFICABILI per stato', () => {
    expect(CAMPI_MODIFICABILI.DRAFT).toHaveLength(17)
    const termini = [
      'description',
      'cerCodes',
      'pricingModel',
      'basePrice',
      'unitOfMeasure',
      'endDate',
      'durationMonths',
      'autoRenew',
      'renewalNoticeDays',
      'paymentTerms',
      'billingFrequency',
    ]
    expect([...CAMPI_MODIFICABILI.ACTIVE].sort()).toEqual([...termini].sort())
    expect([...CAMPI_MODIFICABILI.SUSPENDED].sort()).toEqual([...termini].sort())
    for (const s of ['PENDING_APPROVAL', 'EXPIRED', 'TERMINATED'] as ContractStatus[])
      expect(CAMPI_MODIFICABILI[s]).toEqual([])
    expect(STATI_ELIMINABILI).toEqual(['DRAFT', 'PENDING_APPROVAL'])
  })

  it("ogni campo ha un'etichetta", () => {
    for (const c of CAMPI_MODIFICABILI.DRAFT) expect(ETICHETTE_CAMPI[c]).toBeTruthy()
  })

  it('motivoNonModificabile', () => {
    for (const s of ['DRAFT', 'ACTIVE', 'SUSPENDED'] as ContractStatus[])
      expect(motivoNonModificabile(s)).toBeNull()
    expect(motivoNonModificabile('PENDING_APPROVAL')).toBe(
      'Un contratto in approvazione non si modifica: riportalo in bozza per correggerlo.'
    )
    expect(motivoNonModificabile('EXPIRED')).toBe('Un contratto scaduto non si modifica.')
    expect(motivoNonModificabile('TERMINATED')).toBe('Un contratto cessato non si modifica.')
  })

  it('motivoNonEliminabile', () => {
    expect(motivoNonEliminabile('DRAFT')).toBeNull()
    expect(motivoNonEliminabile('PENDING_APPROVAL')).toBeNull()
    for (const s of ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED'] as ContractStatus[])
      expect(motivoNonEliminabile(s)).toBe(
        'Si eliminano solo i contratti in bozza o in approvazione: per chiudere questo contratto portalo in stato Cessato.'
      )
  })

  describe('pianificaModifica', () => {
    it('modifica vuota', () => {
      expect(pianificaModifica('DRAFT', bozza(), {})).toEqual({ esito: 'NESSUNA_MODIFICA' })
    })
    it('stessi valori', () => {
      const r = pianificaModifica('DRAFT', bozza(), {
        contractNumber: '  CTR-2026-001 ',
        startDate: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r).toEqual({ esito: 'NESSUNA_MODIFICA' })
    })
    it('cerCodes in altro ordine: nessun campo cambiato', () => {
      expect(pianificaModifica('DRAFT', bozza(), { cerCodes: ['150102', '150101'] })).toEqual({
        esito: 'NESSUNA_MODIFICA',
      })
    })
    it('cerCodes con duplicato: ordinato e senza duplicati', () => {
      const r = pianificaModifica('DRAFT', bozza(), { cerCodes: ['150103', '150101', '150103'] })
      expect(r).toMatchObject({ esito: 'OK', cambiati: ['cerCodes'] })
      if (r.esito === 'OK') expect(r.dopo.cerCodes).toEqual(['150101', '150103'])
    })
    it('null su endDate svuota, assente non cambia', () => {
      const r = pianificaModifica('DRAFT', bozza(), { endDate: null })
      expect(r).toMatchObject({ esito: 'OK', cambiati: ['endDate'] })
      if (r.esito === 'OK') expect(r.dopo.endDate).toBeNull()
      expect(pianificaModifica('DRAFT', bozza(), { endDate: undefined })).toEqual({
        esito: 'NESSUNA_MODIFICA',
      })
    })
    it("description '  ' diventa null", () => {
      const r = pianificaModifica('DRAFT', bozza(), { description: '  ' })
      if (r.esito !== 'OK') throw new Error('atteso OK')
      expect(r.dopo.description).toBeNull()
    })
    it('null su contractNumber: NON_VALIDA', () => {
      const r = pianificaModifica('DRAFT', bozza(), { contractNumber: null })
      expect(r).toEqual({ esito: 'NON_VALIDA', messaggi: ['Numero è obbligatorio.'] })
    })
    it('null su campo obbligatorio: accordo di genere e numero', () => {
      const msg = (c: Parameters<typeof pianificaModifica>[2]) => {
        const r = pianificaModifica('DRAFT', bozza(), c)
        return r.esito === 'NON_VALIDA' ? r.messaggi : null
      }
      expect(msg({ cerCodes: null })).toEqual(['Codici CER sono obbligatori.'])
      expect(msg({ renewalNoticeDays: null })).toEqual(['Giorni di preavviso sono obbligatori.'])
      expect(msg({ billingFrequency: null })).toEqual(['Frequenza di fatturazione è obbligatoria.'])
      expect(msg({ unitOfMeasure: null })).toEqual(['Unità di misura è obbligatoria.'])
      expect(msg({ counterpartyId: null })).toEqual(['Controparte è obbligatoria.'])
      expect(msg({ paymentTerms: null })).toEqual(['Termini di pagamento sono obbligatori.'])
    })
    it('ACTIVE: cambia basePrice e endDate', () => {
      const r = pianificaModifica('ACTIVE', bozza(), {
        basePrice: 130,
        endDate: new Date('2027-06-30T00:00:00Z'),
      })
      expect(r).toMatchObject({ esito: 'OK', cambiati: ['basePrice', 'endDate'] })
    })
    it('ACTIVE: producerId e startDate non ammessi', () => {
      const r = pianificaModifica('ACTIVE', bozza(), {
        producerId: 'p2',
        startDate: new Date('2026-02-01T00:00:00Z'),
      })
      expect(r).toEqual({
        esito: 'CAMPI_NON_AMMESSI',
        campi: ['producerId', 'startDate'],
        messaggio:
          'In un contratto attivo o sospeso non si possono cambiare: Produttore, Data di inizio.',
      })
    })
    it("ACTIVE: producerId uguale all'attuale non blocca", () => {
      const r = pianificaModifica('ACTIVE', bozza(), { producerId: 'p1', basePrice: 99 })
      expect(r).toMatchObject({ esito: 'OK', cambiati: ['basePrice'] })
    })
    it('DRAFT: cambia tutto', () => {
      const r = pianificaModifica('DRAFT', bozza(), {
        contractNumber: 'X-1',
        producerId: 'p2',
        counterpartyId: 'c2',
        counterpartyType: 'DISPOSER',
        contractType: 'FULL_SERVICE',
        description: 'Altro',
        cerCodes: ['200101'],
        pricingModel: 'HYBRID',
        basePrice: 1,
        unitOfMeasure: 't',
        startDate: new Date('2026-02-01T00:00:00Z'),
        endDate: new Date('2026-03-01T00:00:00Z'),
        durationMonths: 1,
        autoRenew: true,
        renewalNoticeDays: 10,
        paymentTerms: 'net_60',
        billingFrequency: 'yearly',
      })
      expect(r.esito).toBe('OK')
      if (r.esito === 'OK') expect(r.cambiati).toHaveLength(17)
    })
    it('basePrice 120.5 contro Decimal "120.50": nessun cambio', () => {
      const attuale = normalizzaDati({
        ...bozza(),
        basePrice: { toNumber: () => Number('120.50') },
      })
      expect(pianificaModifica('DRAFT', attuale, { basePrice: 120.5 })).toEqual({
        esito: 'NESSUNA_MODIFICA',
      })
    })
  })

  describe('validaDatiContratto', () => {
    it('valido', () => expect(validaDatiContratto(bozza())).toEqual([]))
    it('fine prima dell’inizio', () => {
      expect(validaDatiContratto(bozza({ endDate: new Date('2025-12-31T00:00:00Z') }))).toEqual([
        'La data di fine non può precedere la data di inizio.',
      ])
    })
    it('fine uguale all’inizio', () => {
      expect(validaDatiContratto(bozza({ endDate: new Date('2026-01-01T00:00:00Z') }))).toEqual([])
    })
    it('zero CER', () => {
      expect(validaDatiContratto(bozza({ cerCodes: [] }))).toEqual(['Indica almeno un codice CER.'])
    })
    it('CER non valido', () => {
      expect(validaDatiContratto(bozza({ cerCodes: ['15010'] }))).toEqual([
        'Codice CER non valido: 15010.',
      ])
    })
    it('numero di 51 caratteri', () => {
      expect(validaDatiContratto(bozza({ contractNumber: 'a'.repeat(51) }))).toHaveLength(1)
    })
    it('basePrice, durata, preavviso, unità', () => {
      expect(validaDatiContratto(bozza({ basePrice: -1 }))).toHaveLength(1)
      expect(validaDatiContratto(bozza({ durationMonths: 0 }))).toHaveLength(1)
      expect(validaDatiContratto(bozza({ durationMonths: 1.5 }))).toHaveLength(1)
      expect(validaDatiContratto(bozza({ renewalNoticeDays: -1 }))).toHaveLength(1)
      expect(validaDatiContratto(bozza({ unitOfMeasure: '' }))).toHaveLength(1)
      expect(validaDatiContratto(bozza({ unitOfMeasure: 'x'.repeat(11) }))).toHaveLength(1)
    })
    it('più errori insieme, nell’ordine dei campi', () => {
      const m = validaDatiContratto(
        bozza({ contractNumber: '', cerCodes: [], basePrice: -1, renewalNoticeDays: -1 })
      )
      expect(m).toEqual([
        'Numero è obbligatorio.',
        'Indica almeno un codice CER.',
        'Il prezzo base non può essere negativo.',
        'I giorni di preavviso devono essere un numero intero, non negativo.',
      ])
    })
  })
})
