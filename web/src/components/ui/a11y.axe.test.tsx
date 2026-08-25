import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Calendar,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  CheckboxField,
  Chip,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ConfirmationDialog,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LiveRegion,
  LoadingRegion,
  NetworkError,
  NotificationDropdown,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  RadioField,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  SegmentedScale,
  SelectField,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SkipLink,
  Skeleton,
  Slider,
  Spinner,
  SuccessDialog,
  Switch,
  SwitchField,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  Textarea,
  TextareaField,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Typography,
} from './index'
import { TranslationProvider } from '../../i18n'
import { axeViolations, expectNoAxeViolations } from '../../test/a11y'

/**
 * The automated WCAG 2.1 AA sweep over every `ui/` primitive (#83).
 *
 * ## What this is for
 *
 * #83 asks for a *measurable baseline* rather than a one-off manual pass, because
 * the previous review's findings were parked as "minors" and never fixed. This
 * file is that baseline: every primitive the barrel exports is rendered in a
 * realistic composition and handed to axe-core at the target level, so a
 * regression fails `npm test` — and therefore CI — rather than waiting for
 * somebody to look.
 *
 * ## Why the specimens are compositions and not bare elements
 *
 * The rules that matter here are relational: `label`, `aria-required-children`,
 * `aria-required-parent`, `nested-interactive`, `listitem`. A `<TableCell>`
 * rendered alone would pass `aria-required-parent` by being outside a table
 * altogether, which is the shape of assertion that "closes the question" without
 * answering it. Each specimen is therefore the smallest markup a page would
 * actually write.
 *
 * ## Why the overlays are opened
 *
 * Radix renders a Dialog, Sheet, Popover, Tooltip, Select and DropdownMenu into a
 * portal, and only when open. A closed specimen contains one button and axe would
 * report — truthfully — that the one button is fine. Those specimens open
 * themselves and assert against `document.body`, which is where the portal lands.
 *
 * ## Contrast is not in scope here
 *
 * happy-dom has no layout engine, so axe reports `color-contrast` as *incomplete*
 * rather than passing. It is disabled in `test/a11y.ts` (see the note there) and
 * measured against `tokens.css` in `styles/inkContrast.test.ts` and the six
 * per-family contrast suites.
 */

afterEach(cleanup)

interface Specimen {
  /** Names the primitive family in a failure message. */
  name: string
  /** The markup a page would actually write. */
  render: () => ReactNode
  /**
   * Runs after mount, for the overlays that have to be opened before there is
   * anything to measure.
   */
  open?: () => Promise<void>
  /**
   * Measure the whole document instead of the render container — set for every
   * specimen whose content is portalled out of it.
   */
  portal?: boolean
}

const NOTIFICATIONS = [
  { id: '1', title: 'Encuesta de clima abierta', description: 'María Herrera la publicó', read: false },
  { id: '2', title: 'Plan de acción vencido', timestamp: 'hace 2 días', read: true },
]

const OPTIONS = [
  { value: 'gestion', label: 'Gestión' },
  { value: 'operaciones', label: 'Operaciones' },
]

async function openTrigger(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name }))
}

const SPECIMENS: Specimen[] = [
  {
    name: 'Button',
    render: () => (
      <>
        <Button>Guardar</Button>
        <Button variant="destructive">Eliminar</Button>
        <Button variant="ghost" size="icon" aria-label="Cerrar">
          <span aria-hidden="true">×</span>
        </Button>
        <Button disabled>Guardar</Button>
      </>
    ),
  },
  {
    name: 'Badge and Chip',
    render: () => (
      <>
        <Badge>Borrador</Badge>
        <Chip tone="critical" label="Atrasado" />
        <Chip tone="good" label="Al día" />
      </>
    ),
  },
  {
    name: 'Input with Label',
    render: () => (
      <>
        <Label htmlFor="nombre">Nombre completo</Label>
        <Input id="nombre" defaultValue="María Herrera" />
      </>
    ),
  },
  {
    name: 'Textarea with Label',
    render: () => (
      <>
        <Label htmlFor="comentario">Comentario</Label>
        <Textarea id="comentario" />
      </>
    ),
  },
  {
    name: 'Checkbox with Label',
    render: () => (
      <>
        <Checkbox id="anon" />
        <Label htmlFor="anon">Respuesta anónima</Label>
      </>
    ),
  },
  {
    name: 'Switch with Label',
    render: () => (
      <>
        <Switch id="recordatorios" />
        <Label htmlFor="recordatorios">Enviar recordatorios</Label>
      </>
    ),
  },
  {
    name: 'RadioGroup',
    render: () => (
      <RadioGroup aria-label="Departamento" defaultValue="gestion">
        {OPTIONS.map((option) => (
          <div key={option.value}>
            <RadioGroupItem id={option.value} value={option.value} />
            <Label htmlFor={option.value}>{option.label}</Label>
          </div>
        ))}
      </RadioGroup>
    ),
  },
  {
    name: 'Slider',
    render: () => <Slider aria-label="Porcentaje de avance" defaultValue={[40]} max={100} />,
  },
  { name: 'TextField', render: () => <TextField label="Nombre completo" description="Como aparece en planilla" /> },
  { name: 'TextareaField', render: () => <TextareaField label="Observaciones" error="Requerido" /> },
  { name: 'SelectField', render: () => <SelectField label="Departamento" options={OPTIONS} /> },
  { name: 'CheckboxField', render: () => <CheckboxField label="Respuesta anónima" /> },
  { name: 'SwitchField', render: () => <SwitchField label="Enviar recordatorios" /> },
  { name: 'RadioField', render: () => <RadioField label="Departamento" options={OPTIONS} /> },
  {
    name: 'SegmentedScale',
    render: () => (
      <SegmentedScale
        min={1}
        max={5}
        minLabel="Nunca"
        maxLabel="Siempre"
        value="3"
        onChange={() => {}}
        label="¿Con qué frecuencia recibe retroalimentación?"
        required
      />
    ),
  },
  {
    name: 'Card',
    render: () => (
      <Card>
        <CardHeader>
          <CardTitle>Participación</CardTitle>
          <CardDescription>Últimos 30 días</CardDescription>
        </CardHeader>
        <CardContent>72 %</CardContent>
      </Card>
    ),
  },
  {
    name: 'Typography and Separator',
    render: () => (
      <>
        <Typography variant="h1">Panel de clima</Typography>
        <Separator />
        <Typography variant="body">Resumen del período.</Typography>
      </>
    ),
  },
  {
    name: 'Avatar',
    render: () => (
      <Avatar>
        <AvatarFallback>MH</AvatarFallback>
      </Avatar>
    ),
  },
  {
    name: 'Table',
    render: () => (
      <Table>
        <TableCaption>Planes de acción por nodo</TableCaption>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Nodo" direction="asc" onSort={() => {}} />
            <TableHead>Responsable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Operaciones</TableCell>
            <TableCell>María Herrera</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
  },
  {
    name: 'Tabs',
    render: () => (
      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="detalle">Detalle</TabsTrigger>
        </TabsList>
        <TabsContent value="resumen">Resumen del período</TabsContent>
        <TabsContent value="detalle">Detalle por pregunta</TabsContent>
      </Tabs>
    ),
  },
  {
    name: 'Accordion',
    render: () => (
      <Accordion type="single" collapsible defaultValue="uno">
        <AccordionItem value="uno">
          <AccordionTrigger>¿Cómo se calcula el semáforo?</AccordionTrigger>
          <AccordionContent>Compara el avance real con el esperado.</AccordionContent>
        </AccordionItem>
      </Accordion>
    ),
  },
  {
    name: 'Collapsible',
    render: () => (
      <Collapsible defaultOpen>
        <CollapsibleTrigger>Filtros avanzados</CollapsibleTrigger>
        <CollapsibleContent>Rango de fechas</CollapsibleContent>
      </Collapsible>
    ),
  },
  {
    name: 'Breadcrumb',
    render: () => (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Inicio</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Planes de acción</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    ),
  },
  {
    name: 'Pagination',
    render: () => (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious label="Anterior" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink isActive>1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext label="Siguiente" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    ),
  },
  { name: 'ScrollArea', render: () => <ScrollArea>Contenido largo</ScrollArea> },
  { name: 'Progress', render: () => <Progress value={40} aria-label="Avance del plan" /> },
  { name: 'Skeleton', render: () => <Skeleton className="h-4 w-24" /> },
  { name: 'Spinner', render: () => <Spinner aria-label="Cargando" /> },
  {
    name: 'LoadingRegion',
    render: () => (
      <LoadingRegion loading label="Cargando planes">
        <p>Listo</p>
      </LoadingRegion>
    ),
  },
  { name: 'LiveRegion', render: () => <LiveRegion>Se guardaron los cambios</LiveRegion> },
  {
    name: 'Alert',
    render: () => (
      <Alert>
        <AlertTitle>Encuesta cerrada</AlertTitle>
        <AlertDescription>Ya no admite respuestas.</AlertDescription>
      </Alert>
    ),
  },
  { name: 'ErrorState', render: () => <ErrorState title="No se pudo cargar" description="Intente de nuevo." /> },
  { name: 'EmptyState', render: () => <EmptyState title="Sin planes de acción" /> },
  { name: 'NetworkError', render: () => <NetworkError title="Sin conexión" retryText="Reintentar" onRetry={() => {}} /> },
  { name: 'Calendar', render: () => <Calendar mode="single" /> },
  {
    name: 'DatePicker',
    render: () => <DatePicker placeholder="Elegir fecha" label="Fecha de compromiso" />,
  },
  { name: 'SkipLink', render: () => <SkipLink href="#main">Ir al contenido</SkipLink> },
  {
    name: 'Dialog (open)',
    portal: true,
    render: () => (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Abrir</Button>
        </DialogTrigger>
        <DialogContent closeLabel="Cerrar">
          <DialogHeader>
            <DialogTitle>Publicar encuesta</DialogTitle>
            <DialogDescription>Se enviará a 42 personas.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button>Publicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
    open: () => openTrigger('Abrir'),
  },
  {
    name: 'AlertDialog (open)',
    portal: true,
    render: () => (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Eliminar</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el plan?</AlertDialogTitle>
            <AlertDialogDescription>No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
    open: () => openTrigger('Eliminar'),
  },
  {
    name: 'ConfirmationDialog (open)',
    portal: true,
    render: () => (
      <ConfirmationDialog
        open
        onOpenChange={() => {}}
        title="¿Cerrar la encuesta?"
        description="Dejará de admitir respuestas."
        confirmText="Cerrar"
        cancelText="Cancelar"
        onConfirm={() => {}}
      />
    ),
  },
  {
    name: 'SuccessDialog (open)',
    portal: true,
    render: () => (
      <SuccessDialog
        open
        onOpenChange={() => {}}
        title="Encuesta publicada"
        description="Se notificó a 42 personas."
        dismissText="Entendido"
      />
    ),
  },
  {
    name: 'Sheet (open)',
    portal: true,
    render: () => (
      <Sheet>
        <SheetTrigger asChild>
          <Button>Filtros</Button>
        </SheetTrigger>
        <SheetContent closeLabel="Cerrar">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
            <SheetDescription>Acote el listado.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    ),
    open: () => openTrigger('Filtros'),
  },
  {
    name: 'Popover (open)',
    portal: true,
    render: () => (
      <Popover>
        <PopoverTrigger asChild>
          <Button>Detalles</Button>
        </PopoverTrigger>
        <PopoverContent>Última respuesta hace 2 días.</PopoverContent>
      </Popover>
    ),
    open: () => openTrigger('Detalles'),
  },
  {
    name: 'Tooltip (open)',
    portal: true,
    render: () => (
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <Button>Exportar</Button>
          </TooltipTrigger>
          <TooltipContent>Descarga el consolidado</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ),
  },
  {
    name: 'DropdownMenu (open)',
    portal: true,
    render: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Acciones</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Plan de acción</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Registrar avance</DropdownMenuItem>
          <DropdownMenuItem>Marcar cumplido</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    open: () => openTrigger('Acciones'),
  },
  {
    name: 'NotificationDropdown (open)',
    portal: true,
    render: () => (
      <NotificationDropdown
        notifications={NOTIFICATIONS}
        triggerLabel="Notificaciones"
        heading="Notificaciones"
        emptyText="Sin notificaciones"
      />
    ),
    open: () => openTrigger('Notificaciones'),
  },
]

describe('every ui/ primitive passes axe at WCAG 2.1 AA', () => {
  for (const specimen of SPECIMENS) {
    it(specimen.name, async () => {
      // Spanish, and not only because two primitives (`Calendar`, `DatePicker`)
      // read the catalogue for their own copy. The product ships to a Costa Rican
      // government user, so an accessible name is only proven if it is proven in
      // the locale that user reads — and the specimens carry accented copy
      // ("Gestión", "¿Cómo se calcula el semáforo?") for the same reason.
      const { container } = render(
        <TranslationProvider initialLocale="es">{specimen.render()}</TranslationProvider>,
      )
      if (specimen.open) await specimen.open()
      await expectNoAxeViolations(specimen.portal ? document.body : container, specimen.name)
    })
  }

  /**
   * The vacuity control, in two halves.
   *
   * **The harness can fail.** A sweep of 45 specimens that reports nothing is the
   * same shape whether every primitive is correct or `axeViolations` silently
   * returns `[]` — a wrong `runOnly` tag, a detached container, an axe that never
   * ran. This renders markup with three unambiguous WCAG A failures and requires
   * axe to name all three.
   */
  it('reports real failures — the vacuity control', async () => {
    const { container } = render(
      <>
        <button type="button" />
        <img src="/logo.png" />
        <input type="text" />
      </>,
    )
    const ids = (await axeViolations(container)).map((violation) => violation.id).sort()
    expect(ids).toEqual(['button-name', 'image-alt', 'label'])
  })

  /**
   * **The sweep can go hollow.** Deleting specimens is the cheapest way to make
   * this file green, and nothing else would notice. So the count is read off the
   * barrel: every `*.tsx` in `ui/` that is not a test is a primitive module, and
   * the sweep must carry at least one specimen per two of them (several modules —
   * `card`, `table`, `breadcrumb`, `pagination` — export a whole family that one
   * specimen composes, which is why the ratio is not 1:1).
   */
  it('covers the primitives that exist — the coverage control', () => {
    const modules = readdirSync(join(process.cwd(), 'src', 'components', 'ui')).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    )
    expect(modules.length).toBeGreaterThan(40)
    expect(SPECIMENS.length).toBeGreaterThanOrEqual(modules.length / 2)
  })
})
