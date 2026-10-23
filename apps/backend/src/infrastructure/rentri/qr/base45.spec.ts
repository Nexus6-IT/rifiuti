import { codificaBase45, decodificaBase45 } from './base45'

/**
 * Vettori di prova dall'RFC 9285 §4.3 ("Examples of encoding"), gli stessi
 * usati da ogni implementazione di riferimento (compresi i validatori
 * ufficiali del certificato COVID digitale europeo, che usano Base45 con lo
 * stesso identico alfabeto): "AB" -> "BB8", "Hello!!" -> "%69 VD92EX0",
 * "base-45" -> "UJCLQE7W581".
 */
describe('Base45 (RFC 9285)', () => {
  describe('codificaBase45', () => {
    it('"AB" -> "BB8"', () => {
      expect(codificaBase45(Buffer.from('AB', 'ascii'))).toBe('BB8')
    })

    it('"Hello!!" -> "%69 VD92EX0"', () => {
      expect(codificaBase45(Buffer.from('Hello!!', 'ascii'))).toBe('%69 VD92EX0')
    })

    it('"base-45" -> "UJCLQE7W581"', () => {
      expect(codificaBase45(Buffer.from('base-45', 'ascii'))).toBe('UJCLQE7W581')
    })

    it('buffer vuoto -> stringa vuota', () => {
      expect(codificaBase45(Buffer.alloc(0))).toBe('')
    })

    it('un solo byte (caso dispari, RFC §4 "n=1"): due caratteri', () => {
      // 0x00 -> c=0 d=0 -> "00"
      expect(codificaBase45(Buffer.from([0]))).toBe('00')
      // 0xFF -> c = 255 % 45 = 30 ('U'), d = floor(255/45) = 5 ('5')
      expect(codificaBase45(Buffer.from([255]))).toBe('U5')
    })
  })

  describe('decodificaBase45 — inversa di codificaBase45', () => {
    it('"BB8" -> "AB"', () => {
      expect(decodificaBase45('BB8').toString('ascii')).toBe('AB')
    })

    it('"%69 VD92EX0" -> "Hello!!"', () => {
      expect(decodificaBase45('%69 VD92EX0').toString('ascii')).toBe('Hello!!')
    })

    it('"UJCLQE7W581" -> "base-45"', () => {
      expect(decodificaBase45('UJCLQE7W581').toString('ascii')).toBe('base-45')
    })

    it('stringa vuota -> buffer vuoto', () => {
      expect(decodificaBase45('')).toEqual(Buffer.alloc(0))
    })

    it('rifiuta un carattere fuori alfabeto', () => {
      expect(() => decodificaBase45('a!!')).toThrow(/fuori alfabeto/)
    })

    it('rifiuta un gruppo finale di un solo carattere', () => {
      expect(() => decodificaBase45('BB8B')).toThrow(/lunghezza residua/)
    })

    it('rifiuta un gruppo di 3 che eccede 0xFFFF ("GGW", il piu piccolo overflow noto dall RFC)', () => {
      // "FGW" = 15 + 16*45 + 44*45*45 = 15+720+89100=89835 > 0xFFFF? verificare a runtime
      expect(() => decodificaBase45('GGW')).toThrow(/eccede 0xFFFF/)
    })
  })

  describe('round-trip su byte casuali', () => {
    it('codifica e decodifica tornano al buffer originale, per varie lunghezze pari e dispari', () => {
      for (const lunghezza of [0, 1, 2, 3, 4, 5, 16, 17, 255, 256]) {
        const bytes = Buffer.alloc(lunghezza)
        for (let i = 0; i < lunghezza; i++) {
          bytes[i] = (i * 37 + 11) % 256
        }
        const codificato = codificaBase45(bytes)
        expect(decodificaBase45(codificato)).toEqual(bytes)
      }
    })

    it("l'alfabeto di uscita e' sempre un sottoinsieme del set alfanumerico QR (0-9 A-Z spazio $%*+-./:)", () => {
      const bytes = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 53 + 7) % 256))
      const codificato = codificaBase45(bytes)
      expect(codificato).toMatch(/^[0-9A-Z $%*+\-./:]*$/)
    })
  })
})
