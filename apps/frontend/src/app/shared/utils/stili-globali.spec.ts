/**
 * Regole globali di stile (styles.scss, styles/_primeng.scss, styles/_pagine.scss, styles/_tokens.scss)
 * che correggono i difetti grafici trovati nel giro «bug grafici». Karma carica solo styles.scss:
 * gli stili di PrimeNG (`@layer primeng`) e di PrimeFlex qui non ci sono, quindi i test li ricreano
 * con le stesse regole che li rendono dannosi, e verificano che la nostra regola vinca.
 */
describe('stili globali', () => {
  let radice: HTMLElement
  let stileProva: HTMLStyleElement

  const stile = (css: string): void => {
    stileProva = document.createElement('style')
    stileProva.textContent = css
    document.head.appendChild(stileProva)
  }
  const monta = (html: string): HTMLElement => {
    radice = document.createElement('div')
    radice.innerHTML = html
    document.body.appendChild(radice)
    return radice
  }
  const css = (el: Element) => getComputedStyle(el)

  afterEach(() => {
    stileProva?.remove()
    radice?.remove()
  })

  describe('reset di margini e padding', () => {
    it('non azzera gli elementi con classe p-... (i loro stili stanno in @layer primeng)', () => {
      stile(
        '@layer primeng { .p-prova { margin-top: -8px; padding-left: 12px } .semplice { margin-top: -8px; padding-left: 12px } }'
      )
      monta('<div class="p-prova">a</div><div class="semplice">b</div>')
      const conP = radice.querySelector('.p-prova') as HTMLElement
      const senzaP = radice.querySelector('.semplice') as HTMLElement
      expect(css(conP).marginTop).toBe('-8px')
      expect(css(conP).paddingLeft).toBe('12px')
      // gli elementi nostri restano azzerati: il reset vale ancora fuori da PrimeNG
      expect(css(senzaP).marginTop).toBe('0px')
      expect(css(senzaP).paddingLeft).toBe('0px')
    })

    it("un elemento con la classe p-... in seconda posizione e' esentato come in prima", () => {
      stile('@layer primeng { .p-prova { margin-top: -8px } }')
      monta('<div class="altra p-prova">a</div>')
      expect(css(radice.firstElementChild as Element).marginTop).toBe('-8px')
    })
  })

  describe('.surface-card', () => {
    it('resta bianco anche con la regola !important di PrimeFlex che usa variabili inesistenti', () => {
      stile(
        '.surface-card { background-color: light-dark(var(--p-surface-0), var(--p-surface-900)) !important }'
      )
      monta('<div class="surface-card">x</div>')
      const bg = css(radice.firstElementChild as Element).backgroundColor
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
      expect(bg).toBe('rgb(255, 255, 255)')
    })
  })

  describe('icona dentro il campo', () => {
    it("sta a meta' altezza del campo anche se il contenitore e' piu' alto", () => {
      stile(
        '@layer primeng { .p-input-icon-left { position: relative; display: inline-block } ' +
          '.p-input-icon-left > i { position: absolute; top: 50%; margin-top: -0.5rem; width: 1rem; height: 1rem } }'
      )
      monta(
        '<span class="p-input-icon-left" style="display:block;height:48px"><i></i><input class="p-inputtext" /></span>'
      )
      const icona = radice.querySelector('i') as HTMLElement
      const campo = radice.querySelector('input') as HTMLElement
      const a = icona.getBoundingClientRect()
      const b = campo.getBoundingClientRect()
      // il contenitore e' 48px, il campo 32px: l'icona segue il centro del campo, non quello del contenitore
      expect(Math.abs(a.top + a.height / 2 - (b.top + b.height / 2))).toBeLessThanOrEqual(8)
      expect(css(icona).marginTop).toBe('0px')
      expect(css(icona).top).toBe(`${(48 - 16) / 2}px`)
    })
  })

  describe('bottone attaccato al campo', () => {
    it("il trigger del calendario e il bottone dell'autocomplete non sono pieni d'inchiostro", () => {
      monta(
        '<span class="p-calendar"><button class="p-button p-datepicker-trigger">c</button></span>' +
          '<span class="p-autocomplete"><button class="p-button p-autocomplete-dropdown">a</button></span>'
      )
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink-fill').trim()
      const sonda = document.createElement('i')
      sonda.style.color = ink
      radice.appendChild(sonda)
      const rgbInk = css(sonda).color
      const sezione = getComputedStyle(document.documentElement)
        .getPropertyValue('--surface-section')
        .trim()
      sonda.style.color = sezione
      const rgbSezione = css(sonda).color
      for (const sel of ['.p-datepicker-trigger', '.p-autocomplete-dropdown']) {
        const b = css(radice.querySelector(sel) as Element)
        expect(b.backgroundColor).not.toBe(rgbInk)
        expect(b.backgroundColor).toBe(rgbSezione)
        expect(b.borderLeftWidth).toBe('0px')
      }
    })
  })

  describe('controlli nativi', () => {
    it("checkbox e radio nativi prendono l'inchiostro del tema come colore di accento", () => {
      monta('<input type="checkbox" /><input type="radio" />')
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink-fill').trim()
      const sonda = document.createElement('i')
      sonda.style.color = ink
      radice.appendChild(sonda)
      const atteso = css(sonda).color
      for (const el of Array.from(radice.querySelectorAll('input'))) {
        expect(css(el).accentColor).toBe(atteso)
      }
    })

    it('il select nativo con classe p-inputtext conserva la freccia nativa', () => {
      stile('@layer primeng { .p-inputtext { appearance: none } }')
      monta('<select class="p-inputtext"><option>Tutti</option></select>')
      expect(css(radice.firstElementChild as Element).appearance).toBe('auto')
    })
  })

  describe('nomi di variabili ereditati dal tema Aura', () => {
    it('puntano ai token del tema (niente blu-ardesia, niente rosso saturo)', () => {
      const r = getComputedStyle(document.documentElement)
      const v = (n: string) => r.getPropertyValue(n).trim()
      expect(v('--text-color-secondary')).toBe(v('--text-secondary'))
      expect(v('--border-color')).toBe(v('--surface-border'))
      expect(v('--red-500')).toBe(v('--color-danger'))
      expect(v('--green-500')).toBe(v('--color-success'))
      expect(v('--surface-200')).toBe(v('--color-gray-200'))
      expect(v('--color-primary')).toBe(v('--ink-fill'))
    })
  })

  describe('contenitore tabella', () => {
    it('non ha sfumature di scorrimento sul fondo', () => {
      monta(
        '<div class="pagina-lavoro"><div class="table-card"><div class="table-responsive">t</div></div></div>'
      )
      expect(css(radice.querySelector('.table-responsive') as Element).backgroundImage).toBe('none')
    })
  })
})
