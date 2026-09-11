import type { SVGProps } from 'react'

/**
 * The rail's glyphs, drawn from the canvas rather than from lucide.
 *
 * Every artboard draws its rail with the same sixteen 16×16 glyphs (`Dashboard.dc.html`,
 * `.nav-row svg { width: 16px; height: 16px; stroke: currentColor; fill: none;
 * stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round }`). Lucide's nearest
 * neighbours read as different pictures at 16px (a four-panel dashboard where the canvas
 * has four equal tiles, a three-ring target where it has two, a kanban where it has a
 * split panel), so the rail carries the canvas's own paths, copied verbatim. Entries the
 * canvas never drew (the employee's inbox, the tracking task list, system health) keep
 * their lucide icon.
 */
function RailGlyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Panel de Control: four equal tiles. */
export function RailDashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </RailGlyph>
  )
}

/** Administración de Empresa / del sistema: the shield. */
export function RailShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />
    </RailGlyph>
  )
}

/** Vista Consolidada: a panel with a header row and a side column. */
export function RailConsolidatedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 7h12M6 7v6" />
    </RailGlyph>
  )
}

/** Planes de Acción: a two-ring target. */
export function RailPlansIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" />
    </RailGlyph>
  )
}

/** Microclimas: three waves (the brand mark's own figure). */
export function RailMicroclimatesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M2 5c2-2 4 2 6 0s4-2 6 0M2 8.5c2-2 4 2 6 0s4-2 6 0M2 12c2-2 4 2 6 0s4-2 6 0" />
    </RailGlyph>
  )
}

/** Todas las Encuestas: a plain clipboard. */
export function RailSurveysIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <rect x="3" y="3" width="10" height="11" rx="1.5" />
      <path d="M6 3V2h4v1M6 8h4M6 11h4" />
    </RailGlyph>
  )
}

/** Plantillas de Encuesta: two stacked rows. */
export function RailTemplatesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
    </RailGlyph>
  )
}

/** Clima en el tiempo: a rising line with its arrowhead. */
export function RailTrendsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M2 12l4-4 3 3 5-6" />
      <path d="M11 5h3v3" />
    </RailGlyph>
  )
}

/** Puntos de Referencia: a low gauge. */
export function RailBenchmarksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M3 11a5.5 5.5 0 0 1 10 0" />
      <path d="M8 11l3-4" />
    </RailGlyph>
  )
}

/** Información de IA: a single four-point sparkle. */
export function RailInsightsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M8 2l1.5 4L14 8l-4.5 2L8 14l-1.5-4L2 8l4.5-2z" />
    </RailGlyph>
  )
}

/** Informes: a plain file with its folded corner. */
export function RailReportsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </RailGlyph>
  )
}

/** Analítica: three bars. */
export function RailAnalyticsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M3 13V8M8 13V4M13 13V6" />
    </RailGlyph>
  )
}

/** Departamentos: an org chart. */
export function RailDepartmentsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <rect x="6" y="2" width="4" height="3" rx="0.8" />
      <rect x="2" y="11" width="4" height="3" rx="0.8" />
      <rect x="10" y="11" width="4" height="3" rx="0.8" />
      <path d="M8 5v3M4 11V8h8v3" />
    </RailGlyph>
  )
}

/** Banco de preguntas: an open book. */
export function RailQuestionBankIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M3 3h4a1.5 1.5 0 0 1 1 .5A1.5 1.5 0 0 1 9 3h4v10H9a1 1 0 0 0-1 .5 1 1 0 0 0-1-.5H3z" />
      <path d="M8 3.5V13" />
    </RailGlyph>
  )
}

/** Biblioteca de preguntas: books on a shelf, the last one leaning. */
export function RailQuestionLibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M3 2h3v12H3zM7 2h3v12H7zM11 3l3 .8-2.8 10L8.5 13z" />
    </RailGlyph>
  )
}

/** Notificaciones: the bell. */
export function RailNotificationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <RailGlyph {...props}>
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1H3z" />
      <path d="M6.5 14h3" />
    </RailGlyph>
  )
}
