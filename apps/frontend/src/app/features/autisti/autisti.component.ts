/**
 * Anagrafica degli autisti (app campo, P1): nome, codice fiscale, patente e scadenze, trasportatore
 * e, per chi lavora con l'app, l'utente con ruolo autista a cui l'autista e' collegato.
 *
 * Nessuna regola di ruolo qui: `puoOperare` arriva dal backend. Un autista non si cancella, si
 * disattiva (resta nello storico dei ritiri). I messaggi 400/403/404/409 del backend si mostrano
 * testuali.
 */
import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../core/services/toast.service'
import { UserAdminService, AdminUser } from '../admin/users/user-admin.service'
import { messaggioErroreRitiri } from '../ritiri/ritiri.model'
import { RegistryService } from '../registry/registry.service'
import { Autista, AutistiService, DatiAutista, nomeAutista } from './autisti.service'

const testo = (s: string): string | null => (s.trim() === '' ? null : s.trim())

@Component({
  selector: 'app-autisti',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, TableModule],
  template: `
    <div class="aut-pagina">
      <div class="aut-barra">
        <div>
          <h1 class="aut-titolo">Autisti</h1>
          <p class="aut-nota">
            Gli autisti guidano i mezzi dei ritiri programmati. Chi usa l'app campo va collegato a
            un utente con ruolo autista: vedrà solo il suo giro.
          </p>
        </div>
        <p-button
          *ngIf="puoOperare()"
          label="Nuovo autista"
          icon="pi pi-plus"
          (onClick)="apri(null, $event)"
          data-testid="au-nuovo"
          ariaLabel="Aggiungi un autista"
        ></p-button>
      </div>

      <p *ngIf="caricamento()" role="status" class="aut-nota">Caricamento…</p>
      <p
        *ngIf="erroreElenco() as e"
        role="alert"
        class="field-error"
        data-testid="au-errore-elenco"
      >
        {{ e }}
      </p>

      <p-table [value]="righe()" styleClass="p-datatable-sm" data-testid="au-tabella">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Autista</th>
            <th scope="col">Codice fiscale</th>
            <th scope="col">Patente</th>
            <th scope="col">Telefono</th>
            <th scope="col">Accesso all'app</th>
            <th scope="col">Stato</th>
            <th scope="col" *ngIf="puoOperare()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr [attr.data-testid]="'au-riga-' + a.id">
            <td>
              <strong>{{ nome(a) }}</strong>
              <div class="aut-nota" *ngIf="a.trasportatoreId">
                {{ nomeTrasportatore(a.trasportatoreId) }}
              </div>
            </td>
            <td>{{ a.codiceFiscale || '—' }}</td>
            <td>
              <ng-container *ngIf="a.patenteNumero || a.patenteScadenza; else senzaPatente">
                {{ a.patenteNumero || '—' }}
                <small class="aut-nota" *ngIf="a.patenteCategoria"
                  >cat. {{ a.patenteCategoria }}</small
                >
                <div *ngIf="a.patenteScadenza as s" class="aut-nota">
                  scade il {{ dataIt(s) }}
                  <span
                    *ngIf="scaduta(s)"
                    class="aut-avviso"
                    [attr.data-testid]="'au-patente-scaduta-' + a.id"
                    >scaduta</span
                  >
                </div>
              </ng-container>
              <ng-template #senzaPatente>—</ng-template>
            </td>
            <td>{{ a.telefono || '—' }}</td>
            <td [attr.data-testid]="'au-accesso-' + a.id">
              {{ a.userId ? nomeUtente(a.userId) : 'Nessuno' }}
            </td>
            <td>{{ a.attivo ? 'Attivo' : 'Disattivato' }}</td>
            <td *ngIf="puoOperare()">
              <p-button
                label="Modifica"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                (onClick)="apri(a, $event)"
                [attr.data-testid]="'au-modifica-' + a.id"
                [ariaLabel]="'Modifica l\\'autista ' + nome(a)"
              ></p-button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="puoOperare() ? 7 : 6">
              <span data-testid="au-vuota">Nessun autista registrato.</span>
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <p-dialog
      [visible]="dialog() !== null"
      (visibleChange)="!$event && chiudi()"
      [header]="dialog()?.modifica ? 'Modifica autista' : 'Nuovo autista'"
      [modal]="true"
      [style]="{ width: '560px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra dell'autista"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" novalidate data-testid="au-form">
        <div class="au-griglia">
          <div class="field">
            <label for="au-nome">Nome <span class="req" aria-hidden="true">*</span></label>
            <input
              id="au-nome"
              type="text"
              class="p-inputtext w-full"
              formControlName="nome"
              maxlength="100"
              autocomplete="off"
              aria-required="true"
              [attr.aria-invalid]="tentato() && !form.value.nome?.trim() ? true : null"
            />
          </div>
          <div class="field">
            <label for="au-cognome">Cognome <span class="req" aria-hidden="true">*</span></label>
            <input
              id="au-cognome"
              type="text"
              class="p-inputtext w-full"
              formControlName="cognome"
              maxlength="100"
              autocomplete="off"
              aria-required="true"
              [attr.aria-invalid]="tentato() && !form.value.cognome?.trim() ? true : null"
            />
          </div>
        </div>
        <div class="field">
          <label for="au-cf">Codice fiscale</label>
          <input
            id="au-cf"
            type="text"
            class="p-inputtext w-full"
            formControlName="codiceFiscale"
            maxlength="16"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="au-trasportatore">Trasportatore</label>
          <select
            id="au-trasportatore"
            class="p-inputtext w-full"
            formControlName="trasportatoreId"
          >
            <option value="">Nessuno</option>
            <option *ngFor="let t of trasportatori()" [value]="t.id">{{ t.ragioneSociale }}</option>
          </select>
        </div>
        <div class="au-griglia">
          <div class="field">
            <label for="au-patente">Numero patente</label>
            <input
              id="au-patente"
              type="text"
              class="p-inputtext w-full"
              formControlName="patenteNumero"
              maxlength="30"
              autocomplete="off"
            />
          </div>
          <div class="field">
            <label for="au-categoria">Categoria</label>
            <input
              id="au-categoria"
              type="text"
              class="p-inputtext w-full"
              formControlName="patenteCategoria"
              maxlength="10"
              autocomplete="off"
            />
          </div>
        </div>
        <div class="au-griglia">
          <div class="field">
            <label for="au-patente-scadenza">Scadenza patente</label>
            <input
              id="au-patente-scadenza"
              type="date"
              class="p-inputtext w-full"
              formControlName="patenteScadenza"
            />
          </div>
          <div class="field">
            <label for="au-cqc-scadenza">Scadenza CQC</label>
            <input
              id="au-cqc-scadenza"
              type="date"
              class="p-inputtext w-full"
              formControlName="cqcScadenza"
            />
          </div>
          <div class="field">
            <label for="au-adr-scadenza">Scadenza ADR</label>
            <input
              id="au-adr-scadenza"
              type="date"
              class="p-inputtext w-full"
              formControlName="adrScadenza"
            />
          </div>
        </div>
        <div class="field">
          <label for="au-telefono">Telefono</label>
          <input
            id="au-telefono"
            type="tel"
            class="p-inputtext w-full"
            formControlName="telefono"
            maxlength="30"
            autocomplete="off"
          />
        </div>
        <div class="field" *ngIf="utentiAutista().length || form.value.userId">
          <label for="au-utente">Utente dell'app campo</label>
          <select id="au-utente" class="p-inputtext w-full" formControlName="userId">
            <option value="">Nessuno</option>
            <option *ngFor="let u of utentiAutista()" [value]="u.id">
              {{ etichettaUtente(u) }}
            </option>
          </select>
          <small class="aut-nota"
            >Gli utenti si creano in Amministrazione → Utenti con il ruolo «Autista».</small
          >
        </div>
        <div class="field" *ngIf="dialog()?.modifica">
          <label class="aut-check"
            ><input type="checkbox" formControlName="attivo" /> Autista attivo</label
          >
        </div>
        <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="au-errore">
          {{ e }}
        </p>
        <div class="aut-azioni">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiudi()"
            ariaLabel="Annulla e chiudi"
          ></p-button>
          <p-button
            label="Salva"
            icon="pi pi-check"
            [loading]="salvataggio()"
            [disabled]="salvataggio()"
            (onClick)="salva()"
            data-testid="au-salva"
            ariaLabel="Salva l'autista"
          ></p-button>
        </div>
      </form>
    </p-dialog>
  `,
  styles: [
    `
      .aut-pagina {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .aut-barra {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--spacing-base);
        flex-wrap: wrap;
      }
      .aut-titolo {
        margin: 0;
      }
      .aut-nota {
        margin: 0;
        color: var(--text-secondary, #555);
        font-size: 0.875rem;
      }
      .aut-avviso {
        color: var(--danger-text, #b00020);
        font-weight: 600;
        margin-left: 0.25rem;
      }
      .aut-azioni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
      }
      .aut-check {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .au-griglia {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: var(--spacing-base);
      }
      .field {
        margin-bottom: var(--spacing-base);
      }
    `,
  ],
})
export class AutistiComponent implements OnInit {
  private readonly servizio = inject(AutistiService)
  private readonly registry = inject(RegistryService)
  private readonly utenti = inject(UserAdminService)
  private readonly toast = inject(ToastService)

  readonly righe = signal<Autista[]>([])
  readonly puoOperare = signal(false)
  readonly caricamento = signal(false)
  readonly erroreElenco = signal<string | null>(null)
  readonly trasportatori = signal<{ id: string; ragioneSociale: string }[]>([])
  /** Utenti con ruolo autista: solo gli amministratori possono elencarli, per gli altri resta vuoto. */
  readonly utentiAutista = signal<AdminUser[]>([])
  readonly dialog = signal<{ modifica: Autista | null } | null>(null)
  readonly tentato = signal(false)
  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  private ritorno: HTMLElement | null = null

  readonly form = new FormGroup({
    nome: new FormControl('', { nonNullable: true }),
    cognome: new FormControl('', { nonNullable: true }),
    codiceFiscale: new FormControl('', { nonNullable: true }),
    trasportatoreId: new FormControl('', { nonNullable: true }),
    patenteNumero: new FormControl('', { nonNullable: true }),
    patenteCategoria: new FormControl('', { nonNullable: true }),
    patenteScadenza: new FormControl('', { nonNullable: true }),
    cqcScadenza: new FormControl('', { nonNullable: true }),
    adrScadenza: new FormControl('', { nonNullable: true }),
    telefono: new FormControl('', { nonNullable: true }),
    userId: new FormControl('', { nonNullable: true }),
    attivo: new FormControl(true, { nonNullable: true }),
  })

  ngOnInit(): void {
    this.carica()
    this.registry.getTrasportatori(1, 100).subscribe({
      next: r => this.trasportatori.set(r.items),
      error: () => this.trasportatori.set([]),
    })
    this.utenti.list().subscribe({
      next: tutti => this.utentiAutista.set(tutti.filter(u => u.role === 'AUTISTA')),
      error: () => this.utentiAutista.set([]),
    })
  }

  carica(): void {
    this.caricamento.set(true)
    this.erroreElenco.set(null)
    this.servizio.elenca().subscribe({
      next: e => {
        this.righe.set(e.righe)
        this.puoOperare.set(e.puoOperare)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreElenco.set(messaggioErroreRitiri(err, 'Impossibile leggere gli autisti.'))
      },
    })
  }

  nome(a: Autista): string {
    return nomeAutista(a)
  }
  nomeTrasportatore(id: string | null): string {
    return this.trasportatori().find(t => t.id === id)?.ragioneSociale ?? ''
  }
  nomeUtente(id: string): string {
    const u = this.utentiAutista().find(x => x.id === id)
    return u ? this.etichettaUtente(u) : 'Utente collegato'
  }
  etichettaUtente(u: AdminUser): string {
    return `${u.lastName} ${u.firstName} (${u.email})`
  }
  dataIt(iso: string): string {
    const [a, m, g] = iso.split('-')
    return `${g}/${m}/${a}`
  }
  /** Scaduta se la data e' prima di oggi (data locale, confronto fra stringhe AAAA-MM-GG). */
  scaduta(iso: string): boolean {
    const oggi = new Date()
    const adesso = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}-${String(oggi.getDate()).padStart(2, '0')}`
    return iso < adesso
  }

  apri(a: Autista | null, ev?: unknown): void {
    const e = ev as { target?: EventTarget | null } | undefined
    this.ritorno =
      (e?.target as HTMLElement | undefined)?.closest?.('button') ??
      (document.activeElement as HTMLElement | null)
    this.errore.set(null)
    this.tentato.set(false)
    this.form.reset({
      nome: a?.nome ?? '',
      cognome: a?.cognome ?? '',
      codiceFiscale: a?.codiceFiscale ?? '',
      trasportatoreId: a?.trasportatoreId ?? '',
      patenteNumero: a?.patenteNumero ?? '',
      patenteCategoria: a?.patenteCategoria ?? '',
      patenteScadenza: a?.patenteScadenza ?? '',
      cqcScadenza: a?.cqcScadenza ?? '',
      adrScadenza: a?.adrScadenza ?? '',
      telefono: a?.telefono ?? '',
      userId: a?.userId ?? '',
      attivo: a?.attivo ?? true,
    })
    this.dialog.set({ modifica: a })
  }

  chiudi(): void {
    this.dialog.set(null)
    const el = this.ritorno
    this.ritorno = null
    setTimeout(() => el?.isConnected && el.focus())
  }

  salva(): void {
    const d = this.dialog()
    if (!d || this.salvataggio()) return
    this.tentato.set(true)
    const v = this.form.getRawValue()
    if (!v.nome.trim() || !v.cognome.trim()) {
      this.errore.set('Nome e cognome sono obbligatori.')
      return
    }
    const dati: DatiAutista = {
      nome: v.nome.trim(),
      cognome: v.cognome.trim(),
      codiceFiscale: testo(v.codiceFiscale),
      trasportatoreId: v.trasportatoreId || null,
      patenteNumero: testo(v.patenteNumero),
      patenteCategoria: testo(v.patenteCategoria),
      patenteScadenza: v.patenteScadenza || null,
      cqcScadenza: v.cqcScadenza || null,
      adrScadenza: v.adrScadenza || null,
      telefono: testo(v.telefono),
      userId: v.userId || null,
      ...(d.modifica ? { attivo: v.attivo } : {}),
    }
    this.errore.set(null)
    this.salvataggio.set(true)
    const richiesta = d.modifica
      ? this.servizio.aggiorna(d.modifica.id, dati)
      : this.servizio.crea(dati)
    richiesta.subscribe({
      next: () => {
        this.salvataggio.set(false)
        this.chiudi()
        this.toast.success(d.modifica ? 'Autista aggiornato.' : 'Autista creato.')
        this.carica()
      },
      error: err => {
        this.salvataggio.set(false)
        this.errore.set(messaggioErroreRitiri(err, 'Salvataggio dell’autista non riuscito.'))
      },
    })
  }
}
