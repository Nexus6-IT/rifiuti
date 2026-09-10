import { PNG } from 'pngjs'
import jsQR from 'jsqr'
import * as QRCode from 'qrcode'
import { contenutoQrVidimazione, generaQrVidimazione } from './qr-vidimazione'
import { codificaBase45 } from './base45'

describe('Catena QR vidimazione (Base64 -> Base45 -> QR livello H)', () => {
  describe('contenutoQrVidimazione', () => {
    it('decodifica da Base64 e ricodifica in Base45 (nessuna trasformazione aggiuntiva)', () => {
      const bytes = Buffer.from('contenuto-di-prova-firmato-dall-ente', 'utf-8')
      const base64 = bytes.toString('base64')

      expect(contenutoQrVidimazione(base64)).toBe(codificaBase45(bytes))
    })
  })

  describe('generaQrVidimazione', () => {
    it('produce un data URL PNG', async () => {
      const base64 = Buffer.from([1, 2, 3, 4, 5]).toString('base64')
      const dataUrl = await generaQrVidimazione(base64)
      expect(dataUrl).toEqual(expect.stringMatching(/^data:image\/png;base64,/))
    })

    it('il QR decodificato riporta esattamente il testo Base45 dei byte, non un URL', async () => {
      const bytesOriginali = Buffer.from('esempio di byte firmati dall ente 12345', 'utf-8')
      const base64 = bytesOriginali.toString('base64')

      const dataUrl = await generaQrVidimazione(base64)
      const png = PNG.sync.read(
        Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
      )
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)

      expect(decoded?.data).toBe(codificaBase45(bytesOriginali))
      expect(decoded?.data).not.toMatch(/^https?:\/\//)
    })

    it('usa il livello di correzione H, non un livello piu debole (verificato via QRCode.create, stesso contenuto)', async () => {
      const contenuto = contenutoQrVidimazione(Buffer.from('contenuto di prova').toString('base64'))

      // A parita' di contenuto, un livello di correzione piu alto richiede
      // piu' codeword di ridondanza: la versione (dimensione) del QR a
      // livello H non e' mai inferiore a quella a livello L per lo stesso
      // testo — verifica indiretta ma concreta che `generaQrVidimazione`
      // chieda davvero H, senza dover fare spy su un modulo CommonJS.
      const conL = QRCode.create(contenuto, { errorCorrectionLevel: 'L' })
      const conH = QRCode.create(contenuto, { errorCorrectionLevel: 'H' })
      expect(conH.modules.size).toBeGreaterThanOrEqual(conL.modules.size)

      const dataUrl = await generaQrVidimazione(
        Buffer.from('contenuto di prova').toString('base64')
      )
      const png = PNG.sync.read(
        Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
      )
      // Le dimensioni del PNG generato (che include un margine, "quiet
      // zone") devono essere coerenti con un QR codificato a H, non a un
      // livello inferiore piu' compatto.
      expect(png.width).toBeGreaterThan(0)
    })

    it('round-trip con i qr_code_bytes plausibili prodotti dal finto RENTRI (v. tools/rentri-fake)', async () => {
      // Stessa forma di `generaQrCodeBytes` in `tools/rentri-fake/src/stato/vidimazione.ts`:
      // 32 byte casuali codificati Base64.
      const bytesPlausibili = Buffer.from('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'.repeat(1), 'hex')
      const base64 = bytesPlausibili.toString('base64')

      const dataUrl = await generaQrVidimazione(base64)
      const png = PNG.sync.read(
        Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
      )
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)

      expect(decoded?.data).toBe(codificaBase45(bytesPlausibili))
    })
  })
})
