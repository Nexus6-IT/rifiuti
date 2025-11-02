import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Dashboard Service
 *
 * Fetches analytics data for dashboard display.
 */
@Injectable({
  providedIn: 'root',
})
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/dashboard`;

  /**
   * Get dashboard data
   */
  getDashboard(dateRange?: {
    startDate: Date;
    endDate: Date;
  }): Observable<DashboardData> {
    let params = new HttpParams();
    if (dateRange) {
      params = params
        .set('startDate', dateRange.startDate.toISOString())
        .set('endDate', dateRange.endDate.toISOString());
    }

    return this.http.get<DashboardData>(this.apiUrl, { params });
  }

  /**
   * Export dashboard as CSV
   */
  exportDashboard(format: 'csv' | 'xlsx' = 'csv'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/export`, {
      params: { format },
      responseType: 'blob',
    });
  }

  /**
   * Download CSV export
   */
  downloadExport(format: 'csv' | 'xlsx' = 'csv'): void {
    this.exportDashboard(format).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `dashboard-${new Date().toISOString().split('T')[0]}.${format}`;
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error: unknown) => {
        console.error('Failed to export dashboard', error);
      },
    });
  }
}

/**
 * Dashboard Data Interface
 */
export interface DashboardData {
  overview: {
    totalFIRs: number;
    totalWasteKg: number;
    completedFIRs: number;
    pendingFIRs: number;
    overdueFIRs: number;
  };
  status: {
    breakdown: Record<string, number>;
    chart: Array<{ status: string; count: number }>;
  };
  waste: {
    totalKg: number;
    byCERCode: Array<{ cerCode: string; count: number; totalQuantity: number }>;
    byDestination: {
      recovery: { count: number; quantity: number };
      disposal: { count: number; quantity: number };
      recyclingRate: number;
    };
    recyclingRate: number;
  };
  rentri: {
    syncRate: number;
    totalCompleted: number;
    synced: number;
    pending: number;
  };
  signatures: {
    completionRate: number;
    total: number;
    completed: number;
    averageTimeHours: number;
  };
  compliance: {
    score: number;
    level: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'CRITICAL';
    factors: {
      signatureCompletionRate: number;
      rentriSyncRate: number;
      overdueRate: number;
    };
  };
  trends: {
    monthOverMonth: {
      current: number;
      previous: number;
      percentage: number;
    };
    prediction: {
      nextMonth: number;
    };
  };
  top: {
    producers: Array<{ partitaIva: string; count: number }>;
    carriers: Array<{ partitaIva: string; count: number }>;
  };
  generatedAt: Date;
}
