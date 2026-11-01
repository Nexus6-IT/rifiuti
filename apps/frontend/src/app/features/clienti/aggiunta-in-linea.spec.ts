import { AggiuntaInLinea } from './aggiunta-in-linea'

describe('AggiuntaInLinea', () => {
  type Chiave = 'condizione' | 'conto'
  let a: AggiuntaInLinea<Chiave>
  let bottone: HTMLButtonElement

  beforeEach(() => {
    a = new AggiuntaInLinea<Chiave>()
    bottone = document.createElement('button')
    document.body.appendChild(bottone)
  })
  afterEach(() => bottone.remove())

  it('apri ricorda il pulsante e chiudi gli rende il focus', async () => {
    const span = document.createElement('span')
    bottone.appendChild(span)
    a.apri('conto', 'edit', { currentTarget: span }, { id: 'x' })
    expect(a.aperto).toBe('conto')
    expect(a.modalita).toBe('edit')
    expect(a.elemento).toEqual({ id: 'x' })
    a.chiudi()
    expect(a.aperto).toBeNull()
    expect(a.elemento).toBeNull()
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(bottone)
  })

  it('bloccaChiusuraEsterna true solo con un sub-dialog aperto', () => {
    expect(a.bloccaChiusuraEsterna(false)).toBeFalse()
    a.apri('condizione', 'create')
    expect(a.bloccaChiusuraEsterna(false)).toBeTrue()
    expect(a.bloccaChiusuraEsterna(true)).toBeFalse()
    a.chiudi()
    expect(a.bloccaChiusuraEsterna(false)).toBeFalse()
  })

  it("salvato applica l'id solo se il campo non è bloccato", () => {
    const applica = jasmine.createSpy('applica')
    a.salvato({ id: 'a1' }, applica, false)
    expect(applica).toHaveBeenCalledOnceWith('a1')
    applica.calls.reset()
    a.salvato({ id: 'a2' }, applica, true)
    expect(applica).not.toHaveBeenCalled()
  })

  it('apri in create azzera elemento', () => {
    a.apri('conto', 'edit', undefined, { id: 'x' })
    a.apri('conto', 'create', undefined, { id: 'y' })
    expect(a.modalita).toBe('create')
    expect(a.elemento).toBeNull()
  })

  it('apri ripiega su ev.target quando currentTarget è null', async () => {
    a.apri('condizione', 'create', { currentTarget: null, target: bottone })
    a.chiudi()
    await new Promise(r => setTimeout(r))
    expect(document.activeElement).toBe(bottone)
  })
})
