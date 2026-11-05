import { ChangeDetectionStrategy, Component, Input } from '@angular/core'

/** Segno del marchio WasteFlow (riquadro in inchiostro con la «W» in fiamma), decorativo. */
@Component({
  selector: 'app-segno-marchio',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="dimensione"
      [attr.height]="dimensione"
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="26" height="26" rx="6" fill="var(--text-primary)" />
      <path
        d="M7 8.5l2.6 9 3.4-6.5 3.4 6.5 2.6-9"
        fill="none"
        stroke="var(--brand-primary-light)"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: [':host { display: inline-flex; flex: none; line-height: 0; }'],
})
export class SegnoMarchioComponent {
  @Input() dimensione = 26
}
