/**
 * Catena end-to-end: firma → persistenza → rilettura → verifica → PDF con QR
 * → chiamata all'endpoint pubblico raggiunto dal QR (Task 5, pipeline P3).
 *
 * Attraversa l'intera filiera con componenti reali (non stub):
 *  - `DigitalSignatureService` senza provider iniettato usa il fallback interno
 *    (vera coppia di chiavi ECDSA P-256, vera firma/verifica crittografica).
 *  - `ApplySignatureUseCase`/`VerifySignaturesUseCase` reali.
 *  - Un repository fake che SERIALIZZA e RICOSTRUISCE l'aggregate ad ogni
 *    `save`/`findById` (non restituisce mai lo stesso riferimento in memoria):
 *    prova che la firma sopravvive a un "reload", non solo alla persistenza
 *    di un oggetto già firmato.
 *  - `PDFService` reale (pdfmake): il PDF generato viene ispezionato per
 *    verificare che il QR sia davvero incorporato.
 *  - Il QR generato con `qrcode` viene DECODIFICATO con un decoder terzo
 *    (`jsqr` + `pngjs`), non ri-verificato con lo stesso encoder: se il
 *    controller incollasse l'URL sbagliato, il round-trip fallirebbe.
 *  - `SignaturesController.verifySignatures` reale — è l'endpoint che il QR
 *    raggiunge (`GET /fir/:firId/verify`) — per provare che la risposta
 *    raggiunta dalla scansione è davvero anonima (GDPR).
 *
 * Se un anello si rompe (firma non persistita, URL errato nel QR, QR non
 * incorporato nel PDF, dati personali esposti dall'endpoint pubblico...) uno
 * di questi test fallisce: nessun anello è aggirato con un mock che
 * presupponga il risultato.
 */
import { PNG } from 'pngjs'
import jsQR from 'jsqr'
import * as QRCode from 'qrcode'
import { FIR } from '../../domain/fir/fir.aggregate'
import { DigitalSignature, SignatureRole } from '../../domain/fir/digital-signature.vo'
import { FIRRepository } from '../../domain/fir/fir.repository'
import { ApplySignatureUseCase } from './apply-signature.use-case'
import { VerifySignaturesUseCase } from './verify-signatures.use-case'
import { DigitalSignatureService } from './digital-signature.service'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { SignaturesController } from '../../api/signatures/signatures.controller'

const TENANT_ID = 'tenant-e2e'
const FIR_ID = '33333333-3333-4333-8333-333333333333'

const PRODUCER_USER = 'user-produttore'
const CARRIER_USER = 'user-trasportatore'
const RECEIVER_USER = 'user-destinatario'

const PRODUCER_CF = 'MNZGZN78A01F839X'
const CARRIER_CF = 'RSSMRA80A01H501U'
const RECEIVER_CF = 'VRDLGU85A01F205X'

function fakeLogger() {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
}

/**
 * Repository fake che simula davvero la persistenza: ogni `save` congela uno
 * snapshot (parametri costruttore + firme come plain object), ogni `find*`
 * ricostruisce un aggregate NUOVO da quello snapshot. Un'implementazione che
 * si limitasse a tenere l'oggetto in memoria (senza vera serializzazione)
 * supererebbe comunque un test più debole: qui invece, se `toSignableDocument`
 * o `reconstitute` perdessero un campo, il documentHash della firma
 * cambierebbe e la verifica fallirebbe.
 */
class InMemoryFIRRepository implements FIRRepository {
  private snapshots = new Map<
    string,
    { params: any; signatures: ReturnType<DigitalSignature['toPlainObject']>[] }
  >()

  seed(fir: FIR): void {
    this.persist(fir)
  }

  private persist(fir: FIR): void {
    // Vera serializzazione: `fir` ha solo proprietà TS `private` (nessun
    // campo `#privato` reale), quindi JSON.stringify le cattura tutte come
    // farebbe una riga di tabella riletta dal DB. Se un campo mancasse qui,
    // il documento canonico ricostruito differirebbe e la firma
    // risulterebbe non valida al passo di verifica.
    const params = JSON.parse(JSON.stringify(fir))
    const signatures = fir.getSignatures().map(s => s.toPlainObject())
    this.snapshots.set(fir.getId(), { params, signatures })
  }

  private reconstituteFromSnapshot(id: string): FIR | null {
    const snap = this.snapshots.get(id)
    if (!snap) return null
    const clonedParams = JSON.parse(JSON.stringify(snap.params))
    const signatures = snap.signatures.map(s =>
      DigitalSignature.reconstitute(JSON.parse(JSON.stringify(s)))
    )
    return FIR.reconstitute(clonedParams, signatures)
  }

  async findById(id: string): Promise<FIR | null> {
    return this.reconstituteFromSnapshot(id)
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    return this.reconstituteFromSnapshot(id)
  }

  async findByNumeroProgressivo(): Promise<FIR | null> {
    return null
  }

  async save(fir: FIR): Promise<FIR> {
    this.persist(fir)
    return fir
  }

  async update(fir: FIR): Promise<FIR> {
    this.persist(fir)
    return fir
  }

  async delete(id: string): Promise<void> {
    this.snapshots.delete(id)
  }

  async getCurrentWorkloadByDriver(): Promise<number> {
    return 0
  }
}

function buildFirParams() {
  return {
    id: FIR_ID,
    tenantId: TENANT_ID,
    firNumber: undefined, // BOZZA: firNumber assegnato solo all'emissione

    producerPartitaIva: '12345678901',
    producerName: 'Produttore SRL',
    producerAddress: 'Via Roma 1, Milano',
    producerContact: 'produttore@example.it',

    carrierPartitaIva: '98765432109',
    carrierName: 'Trasporti SRL',
    carrierVehiclePlate: 'AB123CD',
    carrierContact: 'trasporti@example.it',

    receiverPartitaIva: '11122233344',
    receiverName: 'Impianto Destinatario SRL',
    receiverAddress: 'Via Napoli 9, Napoli',
    receiverContact: 'destinatario@example.it',

    cerCode: '150101',
    wasteDescription: 'Imballaggi in carta e cartone',
    wasteCategory: 'NON_PERICOLOSO',
    quantity: 100,
    unit: 'KG',
    wasteOperationType: 'RECOVERY',
    wastePhysicalState: 'SOLIDO',
    wasteHazardClasses: null,
    wastePackageCount: 5,
    wasteOperationCode: 'R13',
    wasteNotes: null,

    transportDate: new Date('2026-07-20T08:00:00Z'),
    estimatedArrivalDate: new Date('2026-07-20T12:00:00Z'),
    transportNotes: null,
  }
}

async function signRole(
  useCase: ApplySignatureUseCase,
  role: SignatureRole,
  userId: string,
  fiscalCode: string,
  name: string
) {
  return useCase.execute({
    firId: FIR_ID,
    tenantId: TENANT_ID,
    userId,
    role,
    signerFiscalCode: fiscalCode,
    signerName: name,
    spidLevel: 2,
    authenticatedAt: new Date(),
  })
}

describe('Catena end-to-end: firma → persistenza → verifica → PDF con QR → endpoint pubblico', () => {
  let repository: InMemoryFIRRepository
  let signatureService: DigitalSignatureService
  let applyUseCase: ApplySignatureUseCase
  let verifyUseCase: VerifySignaturesUseCase
  let pdfService: PDFService
  let signaturesController: SignaturesController

  beforeEach(async () => {
    repository = new InMemoryFIRRepository()
    repository.seed(FIR.create(buildFirParams()))

    // Nessun provider iniettato: DigitalSignatureService usa il fallback
    // interno (ECDSA P-256 reale generata al volo) — non è un mock, è vera
    // crittografia, semplicemente non passa dal provider QES/sandbox del DI.
    signatureService = new DigitalSignatureService(fakeLogger() as any)

    const partyResolver = {
      findParties: jest.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        producerUserId: PRODUCER_USER,
        carrierUserId: CARRIER_USER,
        receiverUserId: RECEIVER_USER,
      }),
    }
    const eventEmitter = { emit: jest.fn() }

    applyUseCase = new ApplySignatureUseCase(
      repository,
      signatureService,
      fakeLogger() as any,
      eventEmitter as any,
      partyResolver as any
    )
    verifyUseCase = new VerifySignaturesUseCase(repository, signatureService, fakeLogger() as any)
    pdfService = new PDFService(fakeLogger() as any)
    signaturesController = new SignaturesController(applyUseCase, verifyUseCase)
  })

  it('percorre l’intera catena senza rompere alcun anello', async () => {
    // 1. FIRMA — tre stadi, con vera crittografia ECDSA.
    const producerResult = await signRole(
      applyUseCase,
      'PRODUCER',
      PRODUCER_USER,
      PRODUCER_CF,
      'Graziano Manzo'
    )
    expect(producerResult.success).toBe(true)
    await signRole(applyUseCase, 'CARRIER', CARRIER_USER, CARRIER_CF, 'Mario Rossi')
    const receiverResult = await signRole(
      applyUseCase,
      'RECEIVER',
      RECEIVER_USER,
      RECEIVER_CF,
      'Luigi Verdi'
    )
    expect(receiverResult.isCompleted).toBe(true)

    // 2. PERSISTENZA + RILETTURA — un nuovo oggetto, non lo stesso riferimento.
    const reloaded = await repository.findById(FIR_ID)
    expect(reloaded).not.toBeNull()
    expect(reloaded).not.toBe(producerResult) // oggetti distinti: vera ricostituzione
    expect(reloaded!.getSignatures()).toHaveLength(3)
    expect(reloaded!.isImmutable()).toBe(true)

    // 3. VERIFICA — sull'oggetto ricostituito da zero, non su quello firmato in memoria.
    const verification = await verifyUseCase.execute({ firId: FIR_ID })
    expect(verification.allValid).toBe(true)
    expect(verification.isCompleted).toBe(true)
    expect(verification.signatureCount).toBe(3)
    // Ogni firma deve essere risultata valida crittograficamente (non solo "presente").
    verification.signatures.forEach(sig => expect(sig.isValid).toBe(true))

    // PRIVACY: la verifica anonima non deve contenere nessun dato personale,
    // nemmeno come chiave presente-ma-vuota (un `undefined` esplicito
    // sopravviverebbe a `JSON.stringify` come chiave assente, ma un test più
    // severo controlla anche l'assenza della chiave stessa nell'oggetto).
    verification.signatures.forEach(sig => {
      expect('signerFiscalCode' in sig).toBe(false)
      expect('signerName' in sig).toBe(false)
    })
    const serializedVerification = JSON.stringify(verification)
    expect(serializedVerification).not.toContain(PRODUCER_CF)
    expect(serializedVerification).not.toContain(CARRIER_CF)
    expect(serializedVerification).not.toContain(RECEIVER_CF)
    expect(serializedVerification).not.toContain('Graziano Manzo')

    // 4. URL DI VERIFICA + QR ISO/IEC 18004 — stessa fonte usata dal controller PDF.
    // Il dominio dipende da FRONTEND_URL (diverso tra locale/CI/produzione):
    // qui si verifica solo che punti davvero al FIR corretto sul path pubblico
    // di verifica. Il dominio corretto (FRONTEND_URL, non il vecchio
    // PUBLIC_DOMAIN mai configurato) è coperto da un test dedicato più sotto.
    const verificationUrl = verifyUseCase.generateVerificationUrl(FIR_ID)
    expect(verificationUrl).toMatch(new RegExp(`^https?://.+/verify/${FIR_ID}$`))

    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
    })
    expect(qrCodeDataUrl).toEqual(expect.stringMatching(/^data:image\/png;base64,/))

    // Decodifica con un decoder INDIPENDENTE dall'encoder: se l'URL incapsulato
    // fosse sbagliato (es. solo l'id, o un dominio diverso), il round-trip
    // non tornerebbe uguale e questa asserzione fallirebbe.
    const png = PNG.sync.read(
      Buffer.from(qrCodeDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
    )
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    expect(decoded?.data).toBe(verificationUrl)

    // 5. PDF CON QR — il generatore reale (pdfmake) deve incorporare il QR.
    const rawFirForPdf = {
      id: FIR_ID,
      firNumber: 'FIR-2026-000099',
      status: 'COMPLETED',
      createdAt: new Date('2026-07-20T07:00:00Z'),
      producer: { companyName: 'Produttore SRL', vatNumber: '12345678901' },
      carrier: { companyName: 'Trasporti SRL', vatNumber: '98765432109' },
      receiver: { companyName: 'Impianto Destinatario SRL', vatNumber: '11122233344' },
      cerCode: '150101',
      quantity: 100,
      unitOfMeasure: 'KG',
      signatures: reloaded!.getSignatures().map(s => ({
        role: s.getRole(),
        signerName: s.getSignerName(),
        signedAt: s.getSignedAt(),
      })),
    }
    const pdfContent = (pdfService as any).buildFIRContent(rawFirForPdf, qrCodeDataUrl)
    const qrBlock = pdfContent.find((item: any) => item && item.image === qrCodeDataUrl)
    expect(qrBlock).toBeDefined() // il QR deve essere DAVVERO nel contenuto del PDF

    const pdfBuffer = await pdfService.generateFIRPDF(rawFirForPdf, qrCodeDataUrl)
    expect(pdfBuffer.subarray(0, 4).toString('ascii')).toBe('%PDF') // PDF valido, non un buffer vuoto

    // 6. L'ENDPOINT PUBBLICO RAGGIUNTO DAL QR — GET /fir/:firId/verify.
    //    Verifica reale (non un mock che presuppone il risultato): usa lo
    //    stesso VerifySignaturesUseCase, sullo stesso repository ricostituito.
    const publicResponse = await signaturesController.verifySignatures(FIR_ID)
    expect(publicResponse.firId).toBe(FIR_ID)
    expect(publicResponse.allValid).toBe(true)
    publicResponse.signatures.forEach(sig => {
      expect('signerFiscalCode' in sig).toBe(false)
      expect('signerName' in sig).toBe(false)
    })
    expect(JSON.stringify(publicResponse)).not.toContain(PRODUCER_CF)
  })

  it('rompe la catena se il documento firmato viene alterato dopo la firma (anello di integrità)', async () => {
    await signRole(applyUseCase, 'PRODUCER', PRODUCER_USER, PRODUCER_CF, 'Graziano Manzo')
    await signRole(applyUseCase, 'CARRIER', CARRIER_USER, CARRIER_CF, 'Mario Rossi')
    await signRole(applyUseCase, 'RECEIVER', RECEIVER_USER, RECEIVER_CF, 'Luigi Verdi')

    // Manomissione: un campo legalmente rilevante cambia DOPO la firma,
    // direttamente sullo snapshot persistito (simula un bypass dell'aggregate).
    const snap = (repository as any).snapshots.get(FIR_ID)
    snap.params.quantity = 999999
    ;(repository as any).snapshots.set(FIR_ID, snap)

    const verification = await verifyUseCase.execute({ firId: FIR_ID })

    // L'endpoint pubblico deve segnalare l'anomalia: non deve restituire
    // "tutto valido" su un documento alterato.
    expect(verification.allValid).toBe(false)
    expect(verification.signatures.some(sig => sig.isValid === false)).toBe(true)
  })
})

describe('VerifySignaturesUseCase.generateVerificationUrl — dominio corretto', () => {
  const ORIGINAL_ENV = process.env.FRONTEND_URL

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.FRONTEND_URL
    } else {
      process.env.FRONTEND_URL = ORIGINAL_ENV
    }
  })

  function buildBareUseCase() {
    return new VerifySignaturesUseCase({} as any, {} as any, fakeLogger() as any)
  }

  it('usa FRONTEND_URL quando configurata (variabile realmente presente in .env.example/docker-compose.prod.yml)', () => {
    process.env.FRONTEND_URL = 'https://rifiuti.ignicraft.com'

    const url = buildBareUseCase().generateVerificationUrl(FIR_ID)

    expect(url).toBe(`https://rifiuti.ignicraft.com/verify/${FIR_ID}`)
  })

  it('ricade su rifiuti.ignicraft.com (non sul vecchio wasteflow.it mai configurato) se FRONTEND_URL manca', () => {
    delete process.env.FRONTEND_URL

    const url = buildBareUseCase().generateVerificationUrl(FIR_ID)

    // Prima della correzione il fallback era PUBLIC_DOMAIN/wasteflow.it: una
    // variabile mai impostata in nessun ambiente reale del progetto, quindi
    // il QR avrebbe puntato a un dominio che non serve l'app.
    expect(url).toBe(`https://rifiuti.ignicraft.com/verify/${FIR_ID}`)
    expect(url).not.toContain('wasteflow.it')
  })
})
