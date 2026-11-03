import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RifiutoDto } from './fir/dtos/create-fir.dto'
import { AccettaFirRentriDto } from './rentri/dto/accetta-fir-rentri.dto'
import { CreateContractDto } from '../application/contracts/dto/create-contract.dto'
import { contaDecimali } from '../core/validators/max-decimali'
import { ImpostaTaraDto } from './pese/dto/tara.dto'
import { StrumentoPesaDto } from './pese/dto/strumento-pesa.dto'

/** Messaggi di validazione del solo campo indicato. */
async function messaggi<T extends object>(
  classe: new () => T,
  dati: object,
  campo: string
): Promise<string[]> {
  const errori = await validate(plainToInstance(classe, dati) as object)
  return errori.filter(e => e.property === campo).flatMap(e => Object.values(e.constraints ?? {}))
}

describe('Limiti dei decimali nei DTO (colonne Decimal e tracciato RENTRI)', () => {
  describe('RifiutoDto.quantita (FIR.quantity è Decimal(10,2))', () => {
    const base = { cerCode: '13 02 05*' }
    it('due decimali: valida', async () => {
      expect(await messaggi(RifiutoDto, { ...base, quantita: 120.55 }, 'quantita')).toEqual([])
    })
    it('tre decimali: rifiutata con messaggio italiano col nome del campo', async () => {
      const m = await messaggi(RifiutoDto, { ...base, quantita: 120.555 }, 'quantita')
      expect(m).toEqual(['La quantità deve essere un numero con al massimo 2 decimali.'])
    })
    it('sotto il minimo: messaggio italiano', async () => {
      const m = await messaggi(RifiutoDto, { ...base, quantita: 0 }, 'quantita')
      expect(m).toEqual(['La quantità deve essere almeno 0,01.'])
    })
  })

  describe('AccettaFirRentriDto.quantitaAccettataKg', () => {
    const base = { tipoAccettazione: 'P' }
    it('due decimali: valida', async () => {
      expect(
        await messaggi(
          AccettaFirRentriDto,
          { ...base, quantitaAccettataKg: 80.25 },
          'quantitaAccettataKg'
        )
      ).toEqual([])
    })
    it('tre decimali: rifiutata col nome del campo', async () => {
      const m = await messaggi(
        AccettaFirRentriDto,
        { ...base, quantitaAccettataKg: 80.255 },
        'quantitaAccettataKg'
      )
      expect(m).toHaveLength(1)
      expect(m[0]).toContain('La quantità accettata')
      expect(m[0]).toContain('2 decimali')
    })
    it('respinto: il campo non è richiesto', async () => {
      expect(
        await messaggi(AccettaFirRentriDto, { tipoAccettazione: 'R' }, 'quantitaAccettataKg')
      ).toEqual([])
    })
  })

  describe('CreateContractDto.basePrice (Decimal(10,2))', () => {
    it.each([0, 120.5, 99999999.99])('%p: valido', async v => {
      expect(await messaggi(CreateContractDto, { basePrice: v }, 'basePrice')).toEqual([])
    })
    it('tre decimali: rifiutato', async () => {
      expect(await messaggi(CreateContractDto, { basePrice: 1.005 }, 'basePrice')).toEqual([
        'Il prezzo base deve essere un numero con al massimo 2 decimali.',
      ])
    })
    it('oltre otto cifre intere: rifiutato', async () => {
      expect(await messaggi(CreateContractDto, { basePrice: 100000000 }, 'basePrice')).toEqual([
        'Il prezzo base non può superare 99.999.999,99.',
      ])
    })
    it('negativo: rifiutato', async () => {
      expect(await messaggi(CreateContractDto, { basePrice: -1 }, 'basePrice')).toEqual([
        'Il prezzo base non può essere negativo.',
      ])
    })
  })

  describe('Pese: tara, portata e divisione', () => {
    it('tara: due decimali sì, tre no', async () => {
      expect(await messaggi(ImpostaTaraDto, { taraKg: 7200.25 }, 'taraKg')).toEqual([])
      expect(await messaggi(ImpostaTaraDto, { taraKg: 7200.255 }, 'taraKg')).toEqual([
        'La tara deve essere un numero con al massimo 2 decimali.',
      ])
    })
    it('portata massima: due decimali sì, tre no', async () => {
      expect(await messaggi(StrumentoPesaDto, { portataMaxKg: 60000.5 }, 'portataMaxKg')).toEqual(
        []
      )
      expect(await messaggi(StrumentoPesaDto, { portataMaxKg: 60000.505 }, 'portataMaxKg')).toEqual(
        ['La portata massima deve essere un numero con al massimo 2 decimali.']
      )
    })
    it('divisione (Decimal(8,3)): tre decimali sì, quattro no', async () => {
      expect(await messaggi(StrumentoPesaDto, { divisioneKg: 0.005 }, 'divisioneKg')).toEqual([])
      expect(await messaggi(StrumentoPesaDto, { divisioneKg: 0.0005 }, 'divisioneKg')).toEqual([
        'La divisione deve essere un numero con al massimo 3 decimali.',
      ])
    })
  })

  describe('MaxDecimali: valori anomali (400, mai 500)', () => {
    const esito = async (v: unknown) => messaggi(ImpostaTaraDto, { taraKg: v }, 'taraKg')
    it.each([[1e-7], [1.234], [1.5e-7]])('%p: rifiutato senza lanciare', async v => {
      expect(await esito(v)).toEqual(['La tara deve essere un numero con al massimo 2 decimali.'])
    })
    it.each([[1.23], [1e21], [5e-2], [0]])('%p: valido', async v => {
      expect(await esito(v)).toEqual([])
    })
    it.each([[NaN], [Infinity], [-Infinity], ['1.2'], [null]])('%p: rifiutato', async v => {
      expect(await esito(v)).toHaveLength(1)
    })
    it('contaDecimali conta anche la notazione esponenziale', () => {
      expect(contaDecimali(1e-7)).toBe(7)
      expect(contaDecimali(1.5e-7)).toBe(8)
      expect(contaDecimali(123.45)).toBe(2)
      expect(contaDecimali(1e21)).toBe(0)
    })
  })
})
