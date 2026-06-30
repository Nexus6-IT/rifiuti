import { Component, inject, signal, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { BadgeModule } from 'primeng/badge'
import { ButtonModule } from 'primeng/button'
import { OverlayPanelModule } from 'primeng/overlaypanel'
import { TagModule } from 'primeng/tag'
import { HttpClient } from '@angular/common/http'
import { environment } from '../../../../environments/environment'
import { interval } from 'rxjs'

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, BadgeModule, ButtonModule, OverlayPanelModule, TagModule],
  template: `
    <p-button
      icon="pi pi-bell"
      [rounded]="true"
      [text]="true"
      [badge]="getBadgeValue()"
      badgeSeverity="danger"
      ariaLabel="Notifiche"
      (onClick)="op.toggle($event); loadNotifications()"
    />

    <p-overlayPanel #op [style]="{ width: '400px' }">
      <ng-template pTemplate="content">
        <div class="notification-panel">
          <div class="flex justify-content-between align-items-center mb-3">
            <h3 class="m-0">Notifiche</h3>
            <p-button
              label="Segna tutte lette"
              [text]="true"
              size="small"
              (onClick)="markAllRead()"
              *ngIf="unreadCount() > 0"
            />
          </div>

          <div class="notifications-list" *ngIf="notifications().length > 0">
            <div
              *ngFor="let n of notifications()"
              class="notification-item"
              [class.unread]="!n.read"
              (click)="markRead(n.id)"
            >
              <div class="flex gap-2">
                <i [class]="getIcon(n.severity)" [style.color]="getColor(n.severity)"></i>
                <div class="flex-1">
                  <p class="font-semibold mb-1">{{ n.title }}</p>
                  <p class="text-sm text-gray-600">{{ n.message }}</p>
                  <p class="text-xs text-gray-500 mt-1">
                    {{ formatDate(n.createdAt) }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="notifications().length === 0" class="text-center py-4 text-gray-500">
            Nessuna notifica
          </div>
        </div>
      </ng-template>
    </p-overlayPanel>
  `,
  styles: [
    `
      .notification-panel {
        padding: 1rem;
      }

      .notifications-list {
        max-height: 400px;
        overflow-y: auto;
      }

      .notification-item {
        padding: var(--spacing-md);
        border-bottom: 1px solid var(--surface-border);
        cursor: pointer;
        transition: background var(--transition-fast);
      }

      .notification-item:hover {
        background: var(--surface-hover);
      }

      .notification-item.unread {
        background: var(--color-info-bg);
      }
    `,
  ],
})
export class NotificationBellComponent implements OnInit {
  private readonly http = inject(HttpClient)
  private readonly apiUrl = `${environment.apiUrl}/notifications`

  protected readonly notifications = signal<any[]>([])
  protected readonly unreadCount = signal(0)

  ngOnInit(): void {
    this.loadUnreadCount()
    // Poll every 30 seconds
    interval(30000).subscribe(() => this.loadUnreadCount())
  }

  protected getBadgeValue(): string | undefined {
    const count = this.unreadCount()
    return count > 0 ? String(count) : undefined
  }

  protected async loadNotifications(): Promise<void> {
    const data = await this.http.get<any[]>(this.apiUrl).toPromise()
    this.notifications.set(data || [])
  }

  protected async loadUnreadCount(): Promise<void> {
    const data = await this.http.get<{ count: number }>(`${this.apiUrl}/unread-count`).toPromise()
    this.unreadCount.set(data?.count || 0)
  }

  protected async markRead(id: string): Promise<void> {
    await this.http.post(`${this.apiUrl}/${id}/mark-read`, {}).toPromise()
    this.loadUnreadCount()
    this.loadNotifications()
  }

  protected async markAllRead(): Promise<void> {
    await this.http.post(`${this.apiUrl}/mark-all-read`, {}).toPromise()
    this.unreadCount.set(0)
    this.loadNotifications()
  }

  protected getIcon(severity: string): string {
    const icons: Record<string, string> = {
      INFO: 'pi pi-info-circle',
      WARNING: 'pi pi-exclamation-triangle',
      ERROR: 'pi pi-times-circle',
      SUCCESS: 'pi pi-check-circle',
    }
    return icons[severity] || 'pi pi-bell'
  }

  protected getColor(severity: string): string {
    const colors: Record<string, string> = {
      INFO: 'var(--color-info)',
      WARNING: 'var(--color-warning)',
      ERROR: 'var(--color-danger)',
      SUCCESS: 'var(--color-success)',
    }
    return colors[severity] || 'var(--text-tertiary)'
  }

  protected formatDate(date: string | Date): string {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'Ora'
    if (minutes < 60) return `${minutes}min fa`
    if (hours < 24) return `${hours}h fa`
    return `${days}g fa`
  }
}
