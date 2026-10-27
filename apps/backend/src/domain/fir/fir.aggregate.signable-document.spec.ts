import { createHash } from 'crypto'
import { FIR } from './fir.aggregate'
import { DigitalSignature } from './digital-signature.vo'

/**
 * Test del documento canonico firmabile (`toSignableDocument()`).
 *
 * Copre due difetti storici:
 * 1. Copertura incompleta: solo 8 campi su ~25 rilevanti del formulario
 *    entravano nel documento firmato, quindi potevano essere alterati senza
 *    invalidare la firma.
 * 2. `firNumber` (assegnato solo all'emissione) faceva parte del documento:
 *    una firma apposta in BOZZA diventava non verificabile non appena il FIR
 *    veniva emesso, perché il documento cambiava sotto la firma già apposta.
 */
describe('FIR Aggregate - toSignableDocument()', () => {
  const mockPublicKey = 'mock-public-key-base64'

  /** Props complete, con tutti i campi legalmente rilevanti valorizzati. */
  function fullProps(overrides: Record<string, unknown> = {}) {
    return {
      id: 'fir-123',
      firNumber: '', // non ancora assegnato (BOZZA)
      tenantId: 'tenant-123',
      producerPartitaIva: '12345678901',
      producerName: 'Produttore SRL',
      producerAddress: 'Via Roma 1, Milano',
      producerContact: 'produttore@example.it',
      carrierPartitaIva: '22345678901',
      carrierName: 'Trasporti SPA',
      carrierVehiclePlate: 'AB123CD',
      carrierContact: 'trasporti@example.it',
      receiverPartitaIva: '32345678901',
      receiverName: 'Impianto Destinatario SRL',
      receiverAddress: 'Via Napoli 2, Roma',
      receiverContact: 'destinatario@example.it',
      cerCode: '150101',
      wasteDescription: 'Imballaggi in carta e cartone',
      wasteCategory: 'Non pericoloso',
      quantity: 100,
      unit: 'KG',
      wasteOperationType: 'RECOVERY',
      wastePhysicalState: 'Solido',
      wasteHazardClasses: 'HP4,HP14',
      wastePackageCount: 5,
      wasteOperationCode: 'R13',
      wasteNotes: 'Annotazioni di trasporto particolari',
      transportDate: new Date('2026-01-15T08:00:00.000Z'),
      estimatedArrivalDate: new Date('2026-01-15T12:00:00.000Z'),
      transportNotes: 'Percorso autostradale A1',
      ...overrides,
    }
  }

  function signWith(document: string): DigitalSignature {
    const documentHash = createHash('sha256').update(document, 'utf8').digest('hex')
    return DigitalSignature.create({
      signerFiscalCode: 'RSSMRA80A01H501U',
      signerName: 'Mario Rossi',
      role: 'PRODUCER',
      signatureValue: 'signature-value',
      signatureMethod: 'ECDSA-SHA256',
      certificateHash: 'cert-hash',
      documentHash,
      publicKey: mockPublicKey,
    })
  }

  describe('Step 1 — divergenza firNumber (BOZZA -> EMESSO)', () => {
    it('la firma apposta in BOZZA resta verificabile dopo l’assegnazione del firNumber', () => {
      // 1. FIR in bozza, firNumber non ancora assegnato
      const firInBozza = FIR.create(fullProps({ firNumber: '' }))
      const documentoAllaFirma = firInBozza.toSignableDocument()

      // 2. Il produttore firma il documento in questo stato
      const signature = signWith(documentoAllaFirma)
      firInBozza.applySignature(signature, 'RSSMRA80A01H501U', 2)

      // 3. Emissione: stesso FIR, ma ora con firNumber assegnato (come farebbe
      //    il repository ricostruendo l'aggregate dopo l'emissione)
      const firEmesso = FIR.reconstitute(
        fullProps({ firNumber: 'FIR-2026-000123' }),
        firInBozza.getSignatures()
      )

      // 4. Riverifica la STESSA firma rigenerando il documento corrente
      const documentoAllaVerifica = firEmesso.toSignableDocument()
      const hashAllaVerifica = createHash('sha256')
        .update(documentoAllaVerifica, 'utf8')
        .digest('hex')

      const [persistedSignature] = firEmesso.getSignatures()
      expect(hashAllaVerifica).toBe(persistedSignature.getDocumentHash())
    })

    it('il documento canonico non include firNumber', () => {
      const firBozza = FIR.create(fullProps({ firNumber: '' }))
      const firEmesso = FIR.create(fullProps({ firNumber: 'FIR-2026-000999' }))

      expect(firEmesso.toSignableDocument()).toBe(firBozza.toSignableDocument())
    })
  })

  describe('Step 2 — copertura dei campi legalmente rilevanti', () => {
    const mutations: Array<{ field: string; overrides: Record<string, unknown> }> = [
      { field: 'producerPartitaIva', overrides: { producerPartitaIva: '99999999999' } },
      { field: 'producerName', overrides: { producerName: 'Altro Produttore SRL' } },
      { field: 'producerAddress', overrides: { producerAddress: 'Via Torino 9, Torino' } },
      { field: 'producerContact', overrides: { producerContact: 'altro@example.it' } },
      { field: 'carrierPartitaIva', overrides: { carrierPartitaIva: '88888888888' } },
      { field: 'carrierName', overrides: { carrierName: 'Altri Trasporti SRL' } },
      { field: 'carrierVehiclePlate', overrides: { carrierVehiclePlate: 'ZZ999YY' } },
      { field: 'carrierContact', overrides: { carrierContact: 'altrotrasp@example.it' } },
      { field: 'receiverPartitaIva', overrides: { receiverPartitaIva: '77777777777' } },
      { field: 'receiverName', overrides: { receiverName: 'Altro Impianto SRL' } },
      { field: 'receiverAddress', overrides: { receiverAddress: 'Via Bologna 3, Bologna' } },
      { field: 'receiverContact', overrides: { receiverContact: 'altrodest@example.it' } },
      { field: 'cerCode', overrides: { cerCode: '200301' } },
      { field: 'wasteDescription', overrides: { wasteDescription: 'Rifiuti urbani misti' } },
      { field: 'wasteCategory', overrides: { wasteCategory: 'Pericoloso' } },
      { field: 'quantity', overrides: { quantity: 250 } },
      { field: 'unit', overrides: { unit: 'TON' } },
      { field: 'wasteOperationType', overrides: { wasteOperationType: 'DISPOSAL' } },
      { field: 'wastePhysicalState', overrides: { wastePhysicalState: 'Liquido' } },
      { field: 'wasteHazardClasses', overrides: { wasteHazardClasses: 'HP6' } },
      { field: 'wastePackageCount', overrides: { wastePackageCount: 12 } },
      { field: 'wasteOperationCode', overrides: { wasteOperationCode: 'D13' } },
      { field: 'wasteNotes', overrides: { wasteNotes: 'Note diverse' } },
      {
        field: 'transportDate',
        overrides: { transportDate: new Date('2026-02-20T08:00:00.000Z') },
      },
      {
        field: 'estimatedArrivalDate',
        overrides: { estimatedArrivalDate: new Date('2026-02-20T15:00:00.000Z') },
      },
      { field: 'transportNotes', overrides: { transportNotes: 'Percorso alternativo SS16' } },
    ]

    it.each(mutations)(
      'mutare il campo $field invalida il documento firmato (la verifica deve fallire)',
      ({ overrides }) => {
        const originale = FIR.create(fullProps()).toSignableDocument()
        const mutato = FIR.create(fullProps(overrides)).toSignableDocument()

        // Documenti diversi => hash diverso => la firma calcolata sull'originale
        // non supera più il confronto documentHash === hash(documento corrente)
        // eseguito da VerifySignaturesUseCase.
        expect(mutato).not.toBe(originale)

        const hashOriginale = createHash('sha256').update(originale, 'utf8').digest('hex')
        const hashMutato = createHash('sha256').update(mutato, 'utf8').digest('hex')
        expect(hashMutato).not.toBe(hashOriginale)
      }
    )
  })

  describe('Step 3 — determinismo', () => {
    it('produce byte identici a invocazioni ripetute sullo stesso FIR', () => {
      const fir = FIR.create(fullProps())
      expect(fir.toSignableDocument()).toBe(fir.toSignableDocument())
    })

    it('normalizza le date indipendentemente dal formato di input (Date vs stringa ISO)', () => {
      const conDataOggetto = FIR.create(
        fullProps({ transportDate: new Date('2026-03-01T10:00:00.000Z') })
      )
      const conDataStringa = FIR.create(fullProps({ transportDate: '2026-03-01T10:00:00.000Z' }))

      expect(conDataOggetto.toSignableDocument()).toBe(conDataStringa.toSignableDocument())
    })

    it('non include campi volatili (nessun timestamp di lettura o valore casuale)', () => {
      const fir = FIR.create(fullProps())
      const documento = JSON.parse(fir.toSignableDocument())

      expect(documento).not.toHaveProperty('firNumber')
      expect(documento).not.toHaveProperty('status')
      expect(documento).not.toHaveProperty('readAt')
      expect(documento).not.toHaveProperty('generatedAt')
    })
  })

  describe('Step 3 — versionamento dello schema', () => {
    it('include un identificativo di versione dello schema', () => {
      const fir = FIR.create(fullProps())
      const documento = JSON.parse(fir.toSignableDocument())

      expect(documento.schemaVersion).toBe(FIR.CURRENT_SCHEMA_VERSION)
      expect(typeof documento.schemaVersion).toBe('number')
    })

    it('una firma prodotta con una versione di schema precedente resta legata a quella versione dopo ricostituzione', () => {
      // Simula un FIR persistito quando lo schema era alla versione 1: la
      // ricostituzione deve rispettare quella versione, non quella corrente,
      // cosicché il documento rigenerato coincida con quello firmato allora.
      const fir = FIR.reconstitute(fullProps({ schemaVersion: 1 }), [])
      const documento = JSON.parse(fir.toSignableDocument())

      expect(documento.schemaVersion).toBe(1)
    })
  })
})

describe('FIR Aggregate - versione (lock ottimistico) e documento firmato', () => {
  const props = (versione?: number) => ({
    id: 'fir-123',
    firNumber: '',
    tenantId: 'tenant-123',
    producerPartitaIva: '12345678901',
    cerCode: '150101',
    quantity: 100,
    unit: 'KG',
    ...(versione === undefined ? {} : { versione }),
  })

  it('senza versione nei params vale 1; con versione la riporta', () => {
    expect(FIR.create(props()).getVersione()).toBe(1)
    expect(FIR.reconstitute(props(7)).getVersione()).toBe(7)
  })

  it('il documento canonico non cambia al variare della versione (altrimenti ogni firma romperebbe le precedenti)', () => {
    const v1 = FIR.reconstitute(props(1)).toSignableDocument()
    const v9 = FIR.reconstitute(props(9)).toSignableDocument()
    expect(v9).toBe(v1)
    expect(v1).not.toContain('versione')
  })

  it('registraVersioneSalvata aggiorna la versione senza toccare il documento', () => {
    const fir = FIR.reconstitute(props(1))
    const prima = fir.toSignableDocument()
    fir.registraVersioneSalvata(2)
    expect(fir.getVersione()).toBe(2)
    expect(fir.toSignableDocument()).toBe(prima)
  })
})
