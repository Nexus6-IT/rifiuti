export interface Formulario {
  numero_fir: string
  stato: string
  produttore: string
}

/**
 * Stato in memoria della fake. Volutamente non persistente: ogni avvio
 * riparte pulito, così i test non dipendono dall'ordine di esecuzione.
 */
export class Archivio {
  private formulari = new Map<string, Formulario>()

  azzera(): void {
    this.formulari.clear()
  }

  salvaFormulario(formulario: Formulario): void {
    this.formulari.set(formulario.numero_fir, formulario)
  }

  leggiFormulario(numeroFir: string): Formulario | undefined {
    return this.formulari.get(numeroFir)
  }

  elencaFormulari(): Formulario[] {
    return [...this.formulari.values()]
  }
}
