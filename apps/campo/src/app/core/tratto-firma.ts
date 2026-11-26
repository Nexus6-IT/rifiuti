/**
 * Tratto della firma su schermo: punti raccolti dal dito, in coordinate della tela. Logica pura
 * (nessun DOM), cosi' si prova senza canvas. La tela disegna `tratti()`; l'esportazione in PNG
 * la fa il componente.
 *
 * `sufficiente()` impedisce di "firmare" con un tocco o con un puntino: serve un tratto vero. E'
 * solo un controllo di buon senso sull'interfaccia, NON una verifica dell'identita' di chi firma.
 */
export interface Punto {
  x: number;
  y: number;
}

/** Dimensioni della tela di firma: stesse del PNG inviato (il server accetta 50..1200 x 20..800). */
export const LARGHEZZA_TELA = 600;
export const ALTEZZA_TELA = 240;
/** Lunghezza minima complessiva del tratto, in unita' della tela. */
export const LUNGHEZZA_MINIMA = 120;
/** Estensione minima orizzontale o verticale del tratto. */
export const ESTENSIONE_MINIMA = 40;
/** Tetto ai punti memorizzati: una firma normale ne ha poche centinaia. */
export const PUNTI_MASSIMI = 5000;

export class TrattoFirma {
  private readonly _tratti: Punto[][] = [];
  private inCorso: Punto[] | null = null;
  private totale = 0;

  tratti(): readonly (readonly Punto[])[] {
    return this._tratti;
  }

  inizia(p: Punto): void {
    this.inCorso = [pulisci(p)];
    this._tratti.push(this.inCorso);
    this.totale += 1;
  }

  aggiungi(p: Punto): void {
    const corrente = this.inCorso;
    if (!corrente || this.totale >= PUNTI_MASSIMI) return;
    const q = pulisci(p);
    const ultimo = corrente[corrente.length - 1];
    if (ultimo.x === q.x && ultimo.y === q.y) return;
    corrente.push(q);
    this.totale += 1;
  }

  termina(): void {
    this.inCorso = null;
  }

  pulisci(): void {
    this._tratti.length = 0;
    this.inCorso = null;
    this.totale = 0;
  }

  vuoto(): boolean {
    return this._tratti.every((t) => t.length < 2);
  }

  lunghezza(): number {
    let l = 0;
    for (const t of this._tratti) {
      for (let i = 1; i < t.length; i++) l += Math.hypot(t[i].x - t[i - 1].x, t[i].y - t[i - 1].y);
    }
    return l;
  }

  /** Larghezza e altezza del rettangolo che contiene tutti i punti. */
  estensione(): { larghezza: number; altezza: number } {
    const punti = this._tratti.flat();
    if (punti.length === 0) return { larghezza: 0, altezza: 0 };
    const xs = punti.map((p) => p.x);
    const ys = punti.map((p) => p.y);
    return {
      larghezza: Math.max(...xs) - Math.min(...xs),
      altezza: Math.max(...ys) - Math.min(...ys),
    };
  }

  sufficiente(): boolean {
    const e = this.estensione();
    return (
      this.lunghezza() >= LUNGHEZZA_MINIMA && Math.max(e.larghezza, e.altezza) >= ESTENSIONE_MINIMA
    );
  }
}

/** Tiene il punto dentro la tela (un dito che esce dal bordo non produce coordinate fuori scala). */
function pulisci(p: Punto): Punto {
  const x = Number.isFinite(p.x) ? Math.min(Math.max(p.x, 0), LARGHEZZA_TELA) : 0;
  const y = Number.isFinite(p.y) ? Math.min(Math.max(p.y, 0), ALTEZZA_TELA) : 0;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}
