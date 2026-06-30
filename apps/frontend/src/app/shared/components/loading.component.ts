import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { LoadingService } from '../../core/services/loading.service'

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule, ProgressSpinnerModule],
  template: `
    <div
      class="fixed top-0 left-0 w-full h-full bg-black-alpha-50 flex justify-content-center align-items-center z-5"
      *ngIf="loadingService.loading$ | async"
    >
      <div class="flex flex-column align-items-center gap-3">
        <p-progressSpinner styleClass="w-4rem h-4rem" strokeWidth="4" animationDuration="1s" />
        <p class="text-white text-xl font-medium m-0">Caricamento...</p>
      </div>
    </div>
  `,
  styles: [],
})
export class LoadingComponent {
  constructor(public loadingService: LoadingService) {}
}
