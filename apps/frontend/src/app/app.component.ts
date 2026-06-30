import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { ToastModule } from 'primeng/toast'
import { LoadingComponent } from './shared/components/loading.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastModule, LoadingComponent],
  template: `
    <router-outlet></router-outlet>
    <p-toast></p-toast>
    <app-loading></app-loading>
  `,
})
export class AppComponent {}
