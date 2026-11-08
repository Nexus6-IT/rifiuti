/**
 * Pattern delle liste (styles/_pagine.scss, styles/_primeng.scss): le classi nuove devono valere
 * anche fuori da `.pagina-lavoro`, perche' le pagine dei task 6-15 non l'hanno.
 * Karma carica styles.scss (quindi i nostri stili); gli stili di PrimeNG (`@layer primeng`) no:
 * la struttura `p-table` e' ricreata a mano con le stesse classi.
 */
describe('pattern delle liste (stili globali)', () => {
  let radice: HTMLElement

  const monta = (html: string, larghezza?: number): HTMLElement => {
    radice = document.createElement('div')
    // fuori da qualsiasi `.pagina-lavoro`, di proposito
    radice.style.width = larghezza ? `${larghezza}px` : 'auto'
    radice.innerHTML = html
    document.body.appendChild(radice)
    return radice
  }
  const css = (el: Element) => getComputedStyle(el)

  const tabella = (classe: string): string => `
    <div class="p-datatable ${classe}">
      <table class="p-datatable-table">
        <thead class="p-datatable-thead"><tr><th>Cliente</th><th class="num-col">Totale</th></tr></thead>
        <tbody class="p-datatable-tbody">
          <tr><td class="principale">Rossi</td><td class="m-hide num-col">10</td><td class="m2">Via Roma</td></tr>
        </tbody>
      </table>
      <div class="p-paginator">1-1 di 1</div>
    </div>`

  afterEach(() => radice?.remove())

  describe('.lista-telefono', () => {
    // La media query vale per la larghezza del viewport, non del contenitore: Karma gira in un
    // iframe di larghezza variabile. Si prova quindi solo cio' che dipende dalla classe e, per la
    // parte sotto i 640px, si legge la regola dal foglio di stile (insertRule non serve).
    const regoleTelefono = (): CSSStyleRule[] => {
      const trovate: CSSStyleRule[] = []
      const visita = (regole: CSSRuleList, dentroMedia: boolean): void => {
        for (const r of Array.from(regole)) {
          if (r instanceof CSSMediaRule && /max-width:\s*640px/.test(r.conditionText)) {
            visita(r.cssRules, true)
          } else if (
            r instanceof CSSStyleRule &&
            dentroMedia &&
            r.selectorText.includes('lista-telefono')
          ) {
            trovate.push(r)
          }
        }
      }
      for (const foglio of Array.from(document.styleSheets)) {
        try {
          visita(foglio.cssRules, false)
        } catch {
          /* foglio di un'altra origine */
        }
      }
      return trovate
    }

    it('sotto i 640px nasconde td.m-hide e porta td.m2 a tutta riga, senza dipendere da .pagina-lavoro', () => {
      const regole = regoleTelefono()
      const perSelettore = (frammento: string) =>
        regole.find(r => r.selectorText.includes(frammento))
      expect(perSelettore('td.m-hide')?.style.display).toBe('none')
      expect(perSelettore('td.m2')?.style.gridColumn).toContain('1 / -1')
      expect(regole.every(r => !r.selectorText.includes('pagina-lavoro'))).toBeTrue()
    })

    it("a 390px di viewport td.m-hide ha display none (solo se l'iframe e' abbastanza stretto)", () => {
      if (window.innerWidth > 640) {
        pending("il viewport di Karma supera 640px: la regola e' provata dal foglio di stile")
      }
      monta(tabella('lista-telefono'))
      expect(css(radice.querySelector('td.m-hide') as Element).display).toBe('none')
    })

    it('sopra i 640px le celle restano visibili', () => {
      if (window.innerWidth <= 640) {
        pending('viewport stretto')
      }
      monta(tabella('lista-telefono'))
      expect(css(radice.querySelector('td.m-hide') as Element).display).not.toBe('none')
    })
  })

  describe('.lista-telefono a 390px (iframe)', () => {
    let iframe: HTMLIFrameElement

    /** Iframe largo 390px con gli stessi stili del documento: la media query vale per il suo viewport. */
    const montaIframe = async (html: string): Promise<Document> => {
      iframe = document.createElement('iframe')
      iframe.style.cssText = 'width:390px;height:700px;border:0;position:fixed;left:0;top:0'
      document.body.appendChild(iframe)
      const doc = iframe.contentDocument as Document
      doc.open()
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
      doc.close()
      const caricamenti: Promise<void>[] = []
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => {
        const copia = n.cloneNode(true) as HTMLElement
        if (copia.tagName === 'LINK') {
          caricamenti.push(new Promise(ok => copia.addEventListener('load', () => ok())))
        }
        doc.head.appendChild(copia)
      })
      doc.body.innerHTML = html
      await Promise.all(caricamenti)
      return doc
    }

    const lunga =
      'Acciaierie e Lavorazioni Metalliche della Valdelsa Società Per Azioni Unipersonale'
    const riga = (azioniClasse: string) => `
      <tr>
        <td class="principale">${lunga}</td>
        <td class="m-hide num-col">286.450,00 €</td>
        <td class="m2">01234560528 · Via Roma 1, Colle di Val d'Elsa</td>
        <td class="${azioniClasse}"><button class="p-button" type="button">Modifica</button><button class="p-button" type="button">...</button></td>
      </tr>`
    const tab = (azioniClasse: string) =>
      `<div class="p-datatable lista-telefono"><table class="p-datatable-table">
        <thead class="p-datatable-thead"><tr><th>Cliente</th><th class="num-col">Totale</th><th>m2</th><th>Azioni</th></tr></thead>
        <tbody class="p-datatable-tbody">${riga(azioniClasse)}${riga(azioniClasse)}</tbody></table></div>`

    afterEach(() => iframe?.remove())

    it('righe a due linee da almeno 56px, td.m-hide nascosta, td.m2 a tutta riga, nessuno scroll orizzontale', async () => {
      const doc = await montaIframe(tab('azioni-col'))
      const win = doc.defaultView as Window
      expect(win.innerWidth).toBe(390)
      const tr = doc.querySelector('tbody tr') as HTMLElement
      expect(tr.getBoundingClientRect().height).toBeGreaterThanOrEqual(56)
      expect(win.getComputedStyle(doc.querySelector('td.m-hide') as Element).display).toBe('none')
      const m2 = doc.querySelector('td.m2') as HTMLElement
      expect(m2.getBoundingClientRect().width).toBeGreaterThan(300)
      expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(doc.documentElement.clientWidth)
    })

    it('la cella azioni (mai m-hide) sta nella colonna 2, a destra, con bottoni da almeno 44px', async () => {
      const doc = await montaIframe(tab('azioni-col'))
      const principale = (doc.querySelector('td.principale') as HTMLElement).getBoundingClientRect()
      const azioni = doc.querySelector('td.azioni-col') as HTMLElement
      const r = azioni.getBoundingClientRect()
      expect(doc.defaultView?.getComputedStyle(azioni).display).not.toBe('none')
      expect(r.left).toBeGreaterThanOrEqual(principale.right - 1)
      expect(r.right).toBeLessThanOrEqual(390)
      // sulla stessa altezza del nome, non in una riga a parte sotto
      expect(r.top).toBeLessThan(principale.bottom)
      doc.querySelectorAll('td.azioni-col .p-button').forEach(b => {
        const rb = b.getBoundingClientRect()
        expect(rb.height).toBeGreaterThanOrEqual(44)
        expect(rb.width).toBeGreaterThanOrEqual(44)
      })
    })
  })

  describe('.num-col fuori da .pagina-lavoro', () => {
    it('allinea a destra intestazione e cella, con cifre tabellari', () => {
      monta(tabella('lista-telefono'))
      const th = radice.querySelector('th.num-col') as Element
      const td = radice.querySelector('td.num-col') as Element
      expect(css(th).textAlign).toBe('right')
      expect(css(td).textAlign).toBe('right')
      expect(css(td).fontVariantNumeric).toContain('tabular-nums')
    })
  })

  describe('.senza-righe', () => {
    it('nasconde il paginatore', () => {
      monta(tabella('senza-righe'))
      expect(css(radice.querySelector('.p-paginator') as Element).display).toBe('none')
    })

    it('senza la classe il paginatore resta', () => {
      monta(tabella(''))
      expect(css(radice.querySelector('.p-paginator') as Element).display).not.toBe('none')
    })
  })

  describe('.barra-filtri', () => {
    it("il campo di ricerca e' largo almeno 320px e la lente e' centrata sulla riga", () => {
      monta(
        `<div class="barra-filtri"><span class="barra-filtri__ricerca"><i class="pi pi-search"></i><input type="text" /></span></div>`,
        800
      )
      const campo = radice.querySelector('.barra-filtri__ricerca') as HTMLElement
      expect(campo.getBoundingClientRect().width).toBeGreaterThanOrEqual(320)
      const lente = radice.querySelector('i') as Element
      expect(css(lente).position).toBe('absolute')
      expect(css(lente).top).not.toBe('auto')
    })
  })
})

describe('skeleton-loader (nessun gradiente)', () => {
  it('le barre non hanno background-image', async () => {
    const { SkeletonLoaderComponent } = await import('../components/skeleton-loader.component')
    const { TestBed } = await import('@angular/core/testing')
    const fixture = TestBed.createComponent(SkeletonLoaderComponent)
    fixture.componentInstance.variant = 'text'
    fixture.detectChanges()
    const barra = fixture.nativeElement.querySelector('.skeleton') as Element
    expect(getComputedStyle(barra).backgroundImage).toBe('none')
    fixture.destroy()
  })
})
