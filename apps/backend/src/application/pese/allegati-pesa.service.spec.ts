import { AllegatiPesaService } from './allegati-pesa.service'
import { AllegatoNonValidoError } from './errori-pese'

const PDF = Buffer.concat([Buffer.from('%PDF-'), Buffer.from('1.4 contenuto')])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

describe('AllegatiPesaService', () => {
  let tx: any
  let service: AllegatiPesaService
  beforeEach(() => {
    tx = { allegatoPesa: { create: jest.fn(async ({ data }: any) => ({ id: 'a1', ...data })) } }
    service = new AllegatiPesaService({} as any)
  })

  it('il tipo lo decidono i magic bytes, non quello dichiarato; sha256 e dimensione calcolati', async () => {
    const r = await service.salva(tx, 't', 'u', {
      nomeFile: '../../etc/scontrino.pdf',
      mimeDichiarato: 'image/png',
      contenuto: PDF,
    })

    expect(r).toMatchObject({
      mimeType: 'application/pdf',
      nomeFile: 'scontrino.pdf',
      dimensioneByte: PDF.length,
    })
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('JPEG riconosciuto', async () => {
    expect(
      (await service.salva(tx, 't', 'u', { nomeFile: 'f', mimeDichiarato: '', contenuto: JPG }))
        .mimeType
    ).toBe('image/jpeg')
  })

  it.each([
    [
      'tipo non ammesso',
      Buffer.from('MZ eseguibile'),
      'Sono ammessi solo foto JPEG o PNG e documenti PDF.',
    ],
    ['vuoto', Buffer.alloc(0), "L'allegato è vuoto."],
    [
      'oltre 4 MiB',
      Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]),
      "L'allegato supera i 4 MB.",
    ],
  ])('%s: rifiutato', async (_n, contenuto, msg) => {
    await expect(
      service.salva(tx, 't', 'u', { nomeFile: 'f', mimeDichiarato: 'application/pdf', contenuto })
    ).rejects.toThrow(new AllegatoNonValidoError(msg))
    expect(tx.allegatoPesa.create).not.toHaveBeenCalled()
  })

  it('nome vuoto o con caratteri di controllo ripulito', async () => {
    const r = await service.salva(tx, 't', 'u', {
      nomeFile: ' \u0000 ',
      mimeDichiarato: '',
      contenuto: PDF,
    })
    expect(r.nomeFile).toBe('allegato')
  })
})
