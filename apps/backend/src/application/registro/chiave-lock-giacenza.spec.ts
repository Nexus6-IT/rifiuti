import { chiaveLockGiacenza } from './chiave-lock-giacenza'
import { normalizzaCerCode } from './cer-catalogo'

describe('chiaveLockGiacenza', () => {
  const REG = '11111111-1111-4111-8111-111111111111'

  // Forma che verificaGiacenza usava prima dell'estrazione: la chiave non deve cambiare, o uno
  // scarico in corsa con una vecchia istanza non serializzerebbe piu'.
  const formaPrecedente = (registroId: string, cerNormalizzato: string) =>
    `giacenza|${registroId}|${cerNormalizzato.replace(/\*$/, '')}`

  it.each(['20 03 01', '200301', '20.03.01', '13 02 05*', '130205*', '13 02 05 *', ' 17 01 07 '])(
    'per %p coincide con la forma precedente applicata al CER normalizzato',
    cer => {
      expect(chiaveLockGiacenza(REG, cer)).toBe(formaPrecedente(REG, normalizzaCerCode(cer)))
    }
  )

  it('con e senza asterisco e con spaziatura diversa da la stessa chiave', () => {
    const k = chiaveLockGiacenza(REG, '13 02 05')
    expect(k).toBe(`giacenza|${REG}|13 02 05`)
    expect(chiaveLockGiacenza(REG, '13 02 05*')).toBe(k)
    expect(chiaveLockGiacenza(REG, '130205*')).toBe(k)
  })

  it('registri diversi hanno chiavi diverse', () => {
    expect(chiaveLockGiacenza(REG, '200301')).not.toBe(
      chiaveLockGiacenza('22222222-2222-4222-8222-222222222222', '200301')
    )
  })
})
