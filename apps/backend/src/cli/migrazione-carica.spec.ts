import { leggiArgomenti } from './migrazione-carica'

const T = '33333333-3333-4333-8333-333333333333'
const U = 'AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const base = ['--tenant', T, '--pacchetto', '/p/WW00012026', '--ambito', 'FIR']

describe('migrazione:carica, argomenti', () => {
  it('--operatore e facoltativo e va normalizzato in minuscolo', () => {
    expect(leggiArgomenti(base)?.operatore).toBeUndefined()
    expect(leggiArgomenti([...base, '--operatore', U])?.operatore).toBe(U.toLowerCase())
  })

  it.each([
    ['non UUID', ['--operatore', 'mario']],
    ['ripetuto', ['--operatore', U, '--operatore', U]],
    ['senza valore', ['--operatore']],
  ])('--operatore %s: uso errato', (_n, extra) => {
    expect(leggiArgomenti([...base, ...extra])).toBeNull()
  })
})
