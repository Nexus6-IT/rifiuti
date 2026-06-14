import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import {
  RentriCredentialService,
  RentriCredentialStatus,
} from './rentri-credential.service';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/**
 * Pagina admin per la gestione del certificato di interoperabilità RENTRI del
 * tenant: stato, caricamento (PKCS#12 .p12/.pfx oppure PEM), rimozione.
 * La chiave privata non viene mai mostrata né rinviata dal backend.
 */
@Component({
  selector: 'app-rentri-credential',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    TagModule,
    SelectButtonModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="rentri-credential" style="max-width: 760px; margin: 0 auto;">
      <p-confirmDialog></p-confirmDialog>

      <p-card>
        <ng-template pTemplate="header">
          <div class="p-3">
            <h2>Certificato RENTRI</h2>
            <p class="text-muted">Certificato di interoperabilità per la trasmissione RENTRI del tenant</p>
          </div>
        </ng-template>

        <!-- Non-admin -->
        <div *ngIf="!isAdmin()" class="p-3">
          <p-tag severity="warning" value="Accesso riservato agli amministratori"></p-tag>
          <p class="mt-2">Solo gli amministratori del tenant possono gestire il certificato RENTRI.</p>
        </div>

        <ng-container *ngIf="isAdmin()">
          <!-- Stato attuale -->
          <div class="mb-4">
            <h3>Stato</h3>
            <div *ngIf="loading()">Caricamento…</div>
            <div *ngIf="!loading() && status() as s">
              <p-tag
                [severity]="s.configured ? 'success' : 'danger'"
                [value]="s.configured ? 'Configurato' : 'Non configurato'"
              ></p-tag>
              <div *ngIf="s.configured" class="mt-2">
                <div><strong>Client ID:</strong> {{ s.clientId }}</div>
                <div><strong>Ambiente:</strong> {{ s.environment }}</div>
                <p-button
                  label="Rimuovi certificato"
                  severity="danger"
                  [outlined]="true"
                  styleClass="mt-2"
                  (onClick)="confirmRemove()"
                ></p-button>
              </div>
            </div>
          </div>

          <hr />

          <!-- Caricamento -->
          <h3>{{ status()?.configured ? 'Sostituisci' : 'Carica' }} certificato</h3>

          <div class="mb-3">
            <label class="block mb-2">Client ID (identificativo operatore)</label>
            <input pInputText [(ngModel)]="clientId" class="w-full" placeholder="es. codice operatore RENTRI" />
          </div>

          <div class="grid mb-3">
            <div class="col-12 md:col-6">
              <label class="block mb-2">Ambiente</label>
              <p-dropdown [options]="envOptions" [(ngModel)]="environment" styleClass="w-full"></p-dropdown>
            </div>
            <div class="col-12 md:col-6">
              <label class="block mb-2">Algoritmo</label>
              <p-dropdown [options]="algoOptions" [(ngModel)]="algorithm" styleClass="w-full"></p-dropdown>
            </div>
          </div>

          <div class="mb-3">
            <label class="block mb-2">Modalità</label>
            <p-selectButton [options]="modeOptions" [(ngModel)]="mode" optionLabel="label" optionValue="value"></p-selectButton>
          </div>

          <!-- PKCS#12 -->
          <div *ngIf="mode === 'pkcs12'">
            <div class="mb-3">
              <label class="block mb-2">File certificato (.p12 / .pfx)</label>
              <input type="file" accept=".p12,.pfx" (change)="onFileSelected($event)" />
              <small *ngIf="pkcs12FileName()" class="block mt-1">Selezionato: {{ pkcs12FileName() }}</small>
            </div>
            <div class="mb-3">
              <label class="block mb-2">Passphrase</label>
              <input pInputText type="password" [(ngModel)]="pkcs12Passphrase" class="w-full" />
            </div>
          </div>

          <!-- PEM -->
          <div *ngIf="mode === 'pem'">
            <div class="mb-3">
              <label class="block mb-2">Certificato (PEM)</label>
              <textarea pInputTextarea [(ngModel)]="certificatePem" class="w-full" rows="4"
                placeholder="-----BEGIN CERTIFICATE-----"></textarea>
            </div>
            <div class="mb-3">
              <label class="block mb-2">Chiave privata (PEM)</label>
              <textarea pInputTextarea [(ngModel)]="privateKeyPem" class="w-full" rows="4"
                placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
            </div>
          </div>

          <p-button
            label="Salva certificato"
            icon="pi pi-save"
            [loading]="saving()"
            [disabled]="!canSubmit()"
            (onClick)="save()"
          ></p-button>
        </ng-container>
      </p-card>
    </div>
  `,
})
export class RentriCredentialComponent implements OnInit {
  private readonly credentialService = inject(RentriCredentialService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmationService);

  readonly status = signal<RentriCredentialStatus | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly pkcs12FileName = signal<string | null>(null);

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role;
    return !!role && ADMIN_ROLES.includes(role);
  });

  // Form state
  clientId = '';
  environment = 'demo';
  algorithm: 'RS256' | 'ES256' = 'RS256';
  mode: 'pkcs12' | 'pem' = 'pkcs12';
  pkcs12Base64 = '';
  pkcs12Passphrase = '';
  certificatePem = '';
  privateKeyPem = '';

  readonly envOptions = [
    { label: 'Demo', value: 'demo' },
    { label: 'Produzione', value: 'live' },
  ];
  readonly algoOptions = [
    { label: 'RS256 (certificato RSA)', value: 'RS256' },
    { label: 'ES256 (certificato EC)', value: 'ES256' },
  ];
  readonly modeOptions = [
    { label: 'File PKCS#12 (.p12/.pfx)', value: 'pkcs12' },
    { label: 'PEM (incolla)', value: 'pem' },
  ];

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.loadStatus();
    }
  }

  private loadStatus(): void {
    this.loading.set(true);
    this.credentialService.getStatus().subscribe({
      next: (s) => {
        this.status.set(s);
        if (s.clientId) this.clientId = s.clientId;
        if (s.environment) this.environment = s.environment;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Impossibile caricare lo stato del certificato');
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.pkcs12FileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      // result è "data:...;base64,XXXX": teniamo solo la parte base64.
      const result = reader.result as string;
      this.pkcs12Base64 = result.includes(',') ? result.split(',')[1] : result;
    };
    reader.readAsDataURL(file);
  }

  canSubmit(): boolean {
    if (!this.clientId.trim()) return false;
    if (this.mode === 'pkcs12') return !!this.pkcs12Base64 && !!this.pkcs12Passphrase;
    return !!this.certificatePem.trim() && !!this.privateKeyPem.trim();
  }

  save(): void {
    if (!this.canSubmit()) return;
    this.saving.set(true);

    const base = {
      clientId: this.clientId.trim(),
      algorithm: this.algorithm,
      environment: this.environment,
    };
    const payload =
      this.mode === 'pkcs12'
        ? { ...base, pkcs12Base64: this.pkcs12Base64, pkcs12Passphrase: this.pkcs12Passphrase }
        : { ...base, certificatePem: this.certificatePem.trim(), privateKeyPem: this.privateKeyPem.trim() };

    this.credentialService.setCredential(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Certificato RENTRI salvato');
        this.resetSecrets();
        this.loadStatus();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Errore nel salvataggio del certificato');
      },
    });
  }

  confirmRemove(): void {
    this.confirm.confirm({
      message: 'Rimuovere il certificato RENTRI del tenant? Le trasmissioni live non funzioneranno finché non ne carichi uno nuovo.',
      header: 'Conferma rimozione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.remove(),
    });
  }

  private remove(): void {
    this.credentialService.remove().subscribe({
      next: () => {
        this.toast.success('Certificato rimosso');
        this.resetSecrets();
        this.loadStatus();
      },
      error: () => this.toast.error('Errore nella rimozione del certificato'),
    });
  }

  private resetSecrets(): void {
    this.pkcs12Base64 = '';
    this.pkcs12Passphrase = '';
    this.certificatePem = '';
    this.privateKeyPem = '';
    this.pkcs12FileName.set(null);
  }
}
