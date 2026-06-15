import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { environment } from '../../../../environments/environment';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  metadata?: any;
}

/**
 * Notifications Page Component
 *
 * Displays all user notifications with mark as read functionality.
 */
@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, TooltipModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Notifiche</h1>
          <p class="page-subtitle">
            {{ unreadCount() > 0 ? unreadCount() + ' non lette' : 'Tutte le notifiche sono state lette' }}
          </p>
        </div>
        <div class="page-actions">
          <p-button
            label="Segna tutte come lette"
            icon="pi pi-check"
            (onClick)="markAllAsRead()"
            [disabled]="hasNoUnreadNotifications()"
          ></p-button>
        </div>
      </header>

      <section class="notifications-list" aria-label="Elenco notifiche">
        <article
          *ngFor="let notification of notifications()"
          class="surface-card notification-item"
          [class.notification-item--unread]="!notification.read"
        >
          <div class="notification-icon" aria-hidden="true">
            <i [class]="getNotificationIcon(notification.type)"></i>
          </div>
          <div class="notification-content">
            <h2 class="notification-title">
              {{ notification.title }}
              <p-tag *ngIf="!notification.read" value="Nuovo" severity="info"></p-tag>
            </h2>
            <p class="notification-message">{{ notification.message }}</p>
            <small class="notification-time">{{ formatDate(notification.createdAt) }}</small>
          </div>
          <div class="notification-actions">
            <p-button
              *ngIf="!notification.read"
              icon="pi pi-check"
              [rounded]="true"
              [text]="true"
              severity="success"
              (onClick)="markAsRead(notification.id)"
              pTooltip="Segna come letta"
              [attr.aria-label]="'Segna come letta la notifica: ' + notification.title"
            ></p-button>
          </div>
        </article>

        <div *ngIf="hasNoNotifications()" class="surface-card">
          <div class="empty-state">
            <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessuna notifica</p>
            <p>Quando riceverai aggiornamenti, compariranno qui.</p>
          </div>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .notifications-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-base);
    }

    .notification-item {
      display: flex;
      gap: var(--spacing-base);
      align-items: flex-start;
      padding: var(--spacing-lg);
      transition: box-shadow var(--transition-base), transform var(--transition-base);
    }

    .notification-item:hover { box-shadow: var(--shadow-md); }

    .notification-item--unread {
      border-left: 4px solid var(--brand-primary);
      background-color: var(--brand-primary-50);
    }

    .notification-icon {
      font-size: 1.75rem;
      color: var(--brand-primary);
      flex-shrink: 0;
      line-height: 1;
    }

    .notification-content { flex: 1; min-width: 0; }

    .notification-title {
      margin: 0 0 var(--spacing-sm) 0;
      font-size: var(--font-size-lg);
      font-family: var(--font-display);
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }

    .notification-message {
      margin: 0 0 var(--spacing-sm) 0;
      color: var(--text-secondary);
    }

    .notification-time { color: var(--text-tertiary); }

    .notification-actions { flex-shrink: 0; }

    @media (max-width: 576px) {
      .notification-item { padding: var(--spacing-base); }
    }
  `]
})
export class NotificationsPageComponent implements OnInit {
  protected readonly notifications = signal<Notification[]>([]);
  protected readonly unreadCount = computed(() => this.notifications().filter(n => !n.read).length);
  private readonly apiUrl = `${environment.apiUrl}/notifications`;

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.loadNotifications();
  }

  private async loadNotifications(): Promise<void> {
    try {
      const data = await this.http.get<Notification[]>(`${this.apiUrl}/user`).toPromise();
      this.notifications.set(data || []);
    } catch (error) {
      console.error('Failed to load notifications', error);
    }
  }

  protected async markAsRead(id: string): Promise<void> {
    try {
      await this.http.patch(`${this.apiUrl}/${id}/read`, {}).toPromise();

      // Update local state
      this.notifications.update(notifications =>
        notifications.map(n => n.id === id ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Failed to mark notification as read', error);
    }
  }

  protected async markAllAsRead(): Promise<void> {
    try {
      await this.http.post(`${this.apiUrl}/mark-all-read`, {}).toPromise();

      // Update local state
      this.notifications.update(notifications =>
        notifications.map(n => ({ ...n, read: true }))
      );
    } catch (error) {
      console.error('Failed to mark all as read', error);
    }
  }

  protected getNotificationIcon(type: string): string {
    const icons: Record<string, string> = {
      'FIR_SIGNATURE_REQUIRED': 'pi pi-file-edit',
      'FIR_COMPLETED': 'pi pi-check-circle',
      'RENTRI_SYNC_FAILED': 'pi pi-exclamation-triangle',
      'RENTRI_SYNC_SUCCESS': 'pi pi-check',
      'COMPLIANCE_ALERT': 'pi pi-shield',
      'SYSTEM_NOTIFICATION': 'pi pi-info-circle',
    };
    return icons[type] || 'pi pi-bell';
  }

  protected hasNoUnreadNotifications(): boolean {
    return this.notifications().filter(n => !n.read).length === 0;
  }

  protected hasNoNotifications(): boolean {
    return this.notifications().length === 0;
  }

  protected formatDate(date: string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Proprio ora';
    if (diffMins < 60) return `${diffMins} minuti fa`;
    if (diffHours < 24) return `${diffHours} ore fa`;
    if (diffDays < 7) return `${diffDays} giorni fa`;

    return d.toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
