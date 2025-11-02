import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
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
  imports: [CommonModule, CardModule, ButtonModule, BadgeModule],
  template: `
    <div class="notifications-page">
      <div class="header">
        <h1>Notifiche</h1>
        <p-button
          label="Segna tutte come lette"
          icon="pi pi-check"
          (onClick)="markAllAsRead()"
          [disabled]="hasNoUnreadNotifications()"
        ></p-button>
      </div>

      <div class="notifications-list">
        <p-card *ngFor="let notification of notifications()"
                [ngClass]="{'unread': !notification.read}">
          <div class="notification-item">
            <div class="notification-icon">
              <i [class]="getNotificationIcon(notification.type)"></i>
            </div>
            <div class="notification-content">
              <h3>
                {{ notification.title }}
                <p-badge *ngIf="!notification.read" value="Nuovo" severity="info"></p-badge>
              </h3>
              <p>{{ notification.message }}</p>
              <small>{{ formatDate(notification.createdAt) }}</small>
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
              ></p-button>
            </div>
          </div>
        </p-card>

        <div *ngIf="hasNoNotifications()" class="empty-state">
          <i class="pi pi-inbox" style="font-size: 4rem; color: #ccc;"></i>
          <p>Nessuna notifica</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .notifications-page {
      padding: 1.5rem;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .header h1 {
      margin: 0;
      font-size: 2rem;
      color: #2c3e50;
    }

    .notifications-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .notification-item {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }

    .notification-icon {
      font-size: 2rem;
      color: #3b82f6;
      flex-shrink: 0;
    }

    .notification-content {
      flex: 1;
    }

    .notification-content h3 {
      margin: 0 0 0.5rem 0;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .notification-content p {
      margin: 0 0 0.5rem 0;
      color: #555;
    }

    .notification-content small {
      color: #999;
    }

    .notification-actions {
      flex-shrink: 0;
    }

    ::ng-deep .unread {
      border-left: 4px solid #3b82f6;
      background-color: #f0f9ff;
    }

    .empty-state {
      text-align: center;
      padding: 4rem 0;
      color: #999;
    }

    .empty-state p {
      font-size: 1.2rem;
      margin-top: 1rem;
    }
  `]
})
export class NotificationsPageComponent implements OnInit {
  protected readonly notifications = signal<Notification[]>([]);
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
