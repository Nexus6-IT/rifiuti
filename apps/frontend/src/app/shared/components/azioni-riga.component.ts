import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  ViewChild,
  signal,
} from '@angular/core'
import { MenuItem } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { Menu, MenuModule } from 'primeng/menu'
import { ripristinaFocusDopoDialog } from '../utils/ripristina-focus'

/** Un'azione disponibile su una riga di lista. */
export interface AzioneRiga {
  /** Testo dell'azione (voce del menu, o nome accessibile del bottone principale). */
  etichetta: string
  /** Classi dell'icona (es. `pi pi-pencil`). Il bottone principale la mostra al posto del testo. */
  icona?: string
  /** Azione distruttiva: va in fondo al menu, separata e in rosso. */
  pericolosa?: boolean
  disabilitata?: boolean
  /** Perche' l'azione non e' disponibile: diventa il `title` della voce disabilitata. */
  motivo?: string
  esegui: () => void
}

/**
 * Azioni di una riga di lista: un'azione principale come bottone (di norma «Modifica») e le altre in
 * un menu a comparsa aperto dal bottone ⋯. Senza azioni non rende nulla (utente in sola lettura:
 * la pagina toglie anche la colonna «Azioni»).
 *
 * @example
 * <app-azioni-riga [principale]="{ etichetta: 'Modifica', icona: 'pi pi-pencil', esegui: () => apri(c) }"
 *                  [altre]="[{ etichetta: 'Elimina', pericolosa: true, esegui: () => elimina(c) }]"
 *                  [nome]="c.ragioneSociale" />
 */
@Component({
  selector: 'app-azioni-riga',
  standalone: true,
  imports: [ButtonModule, MenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (principale; as p) {
      <button
        type="button"
        pButton
        class="p-button-text p-button-sm azioni-riga__principale"
        data-testid="azione-principale"
        [icon]="p.icona ?? ''"
        [label]="p.icona ? '' : p.etichetta"
        [disabled]="!!p.disabilitata"
        [attr.title]="p.disabilitata && p.motivo ? p.motivo : null"
        [attr.aria-label]="nomeAccessibile(p)"
        (click)="p.esegui()"
      ></button>
    }
    @if (altre.length > 0) {
      <button
        #apri
        type="button"
        pButton
        icon="pi pi-ellipsis-h"
        class="p-button-text p-button-sm azioni-riga__altre"
        data-testid="azioni-altre"
        aria-haspopup="menu"
        [attr.aria-expanded]="aperto()"
        [attr.aria-label]="etichettaAltre()"
        (click)="menu.toggle($event)"
      ></button>
      <p-menu
        #menu
        [popup]="true"
        appendTo="body"
        [model]="voci()"
        (onShow)="alMostrare()"
        (onHide)="alChiudere()"
      />
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        justify-content: flex-end;
      }
    `,
  ],
})
export class AzioniRigaComponent {
  @Input() principale: AzioneRiga | null = null
  @Input() set altre(valore: AzioneRiga[]) {
    this.altreAzioni = valore ?? []
    this.voci.set(this.costruisciVoci(this.altreAzioni))
  }
  get altre(): AzioneRiga[] {
    return this.altreAzioni
  }
  /** Nome della riga, per i nomi accessibili («Altre azioni per Rossi S.r.l.»). */
  @Input() nome = ''

  @ViewChild('apri') private bottoneApri?: ElementRef<HTMLButtonElement>
  @ViewChild('menu') private menuRef?: Menu
  private contenitoreMenu?: HTMLElement

  protected readonly aperto = signal(false)
  protected readonly voci = signal<MenuItem[]>([])
  private altreAzioni: AzioneRiga[] = []

  protected readonly etichettaAltre = (): string =>
    this.nome.trim() ? `Altre azioni per ${this.nome.trim()}` : 'Altre azioni'

  protected nomeAccessibile(azione: AzioneRiga): string {
    const base = azione.etichetta.trim()
    const nome = this.nome.trim()
    const completo = nome && !base.includes(nome) ? `${base} ${nome}` : base
    return azione.disabilitata && azione.motivo
      ? `${completo}, non disponibile: ${azione.motivo}`
      : completo
  }

  /**
   * Esc chiude il menu (lo fa PrimeNG sulla lista): qui si ferma la propagazione, altrimenti lo
   * stesso Esc arriva al `document` e chiude anche il `p-dialog` che contiene la riga.
   */
  protected alMostrare(): void {
    this.aperto.set(true)
    const contenitore = this.menuRef?.container as HTMLElement | undefined
    if (contenitore) {
      this.contenitoreMenu = contenitore
      contenitore.addEventListener('keydown', this.fermaEsc)
    }
  }

  private readonly fermaEsc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
    }
  }

  /**
   * Alla chiusura il focus torna sul ⋯, a meno che sia gia' andato a un controllo fuori dal menu
   * (clic su un altro campo): `onHide` parte quando la lista, ancora nel DOM, ha il focus.
   */
  protected alChiudere(): void {
    this.aperto.set(false)
    this.contenitoreMenu?.removeEventListener('keydown', this.fermaEsc)
    this.contenitoreMenu = undefined
    const attivo = document.activeElement
    const nelMenu = attivo instanceof Element && attivo.closest('.p-menu') !== null
    if (!attivo || attivo === document.body || nelMenu) {
      this.bottoneApri?.nativeElement.focus()
    }
  }

  /** Normali nell'ordine dato, poi un filetto, poi le pericolose. */
  private costruisciVoci(azioni: AzioneRiga[]): MenuItem[] {
    const normali = azioni.filter(a => !a.pericolosa).map(a => this.voce(a))
    const pericolose = azioni.filter(a => a.pericolosa).map(a => this.voce(a))
    return normali.length > 0 && pericolose.length > 0
      ? [...normali, { separator: true }, ...pericolose]
      : [...normali, ...pericolose]
  }

  private voce(a: AzioneRiga): MenuItem {
    const classi = [
      a.pericolosa ? 'azione-pericolosa' : '',
      a.disabilitata && a.motivo ? 'azione-con-motivo' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const conMotivo = a.disabilitata && a.motivo
    return {
      // il motivo e' testo visibile (seconda riga, `pre-line`) e quindi anche nell'aria-label della voce
      label: conMotivo ? `${a.etichetta}\nNon disponibile: ${a.motivo}` : a.etichetta,
      icon: a.icona,
      disabled: !!a.disabilitata,
      title: a.disabilitata ? a.motivo : undefined,
      styleClass: classi || undefined,
      command: a.disabilitata
        ? undefined
        : () => {
            // se la voce apre un dialog, alla sua chiusura il focus torna qui (vale per ogni pagina)
            const bottone = this.bottoneApri?.nativeElement
            if (bottone) ripristinaFocusDopoDialog(bottone, this.etichettaAltre())
            a.esegui()
          },
    }
  }
}
