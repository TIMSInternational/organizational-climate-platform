import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button'
import { buttonVariants } from './buttonVariants'

/** The split class list a variant/size pair renders with. */
function classesOf(element: HTMLElement): string[] {
  return element.className.split(/\s+/)
}

afterEach(cleanup)

describe('Button', () => {
  it('calls onClick when activated', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is activated by keyboard', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not fire while disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders the child element with asChild, not a nested button', () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Go' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never sets outline-none, so the global focus ring survives', () => {
    // index.css provides the app's only focus indicator via :focus-visible.
    render(<Button>Save</Button>)
    expect(screen.getByRole('button').className).not.toMatch(/outline-none/)
  })

  it('draws the canvas\'s 34px button on size="canvas", and its 34px square on size="icon-canvas"', () => {
    // The Apple design's `.btn` is 34px outside with `padding: 0 14px` (px-3.5), where the
    // default is 32 with 12px.
    render(
      <>
        <Button size="canvas">Cerrar</Button>
        <Button size="icon-canvas" aria-label="Cerrar diálogo" />
        <Button>Guardar</Button>
      </>,
    )
    const canvas = screen.getByRole('button', { name: 'Cerrar' }).className
    expect(canvas).toContain('h-control-canvas')
    expect(canvas.split(/\s+/)).toContain('px-3.5')
    expect(canvas).not.toContain('h-control-lg')
    const icon = screen.getByRole('button', { name: 'Cerrar diálogo' }).className
    expect(icon).toContain('size-control-canvas')
    expect(icon).not.toContain('size-control-lg')
    // The default is untouched: every other screen keeps its 32px button.
    expect(screen.getByRole('button', { name: 'Guardar' }).className).toContain('h-control-lg')
  })

  it('lets className win over the variant height', () => {
    render(<Button className="h-10">Save</Button>)
    const classes = screen.getByRole('button').className
    expect(classes).toContain('h-10')
    expect(classes).not.toContain('h-control-lg')
  })

  /**
   * The Apple design's button family (`occ.css` `.btn`, `.btn.p`, `.btn.t`, `.btn.d`). Each case
   * pins the class the browser paints from AND a class that must be absent, so a variant that
   * fell back to the default would fail rather than pass on shared classes.
   */
  it('fills the primary button with the action blue, the one fill white may sit on', () => {
    render(<Button variant="primary">Nueva encuesta</Button>)
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toContain('bg-accent-blue-fill')
    expect(classes).toContain('text-fg-on-accent')
    // Not the identity blue (white on it is 4.02:1 in light), and flat: no shadow.
    expect(classes).not.toContain('bg-accent-blue')
    expect(classes).not.toContain('shadow-sm')
  })

  it('draws secondary as the bordered neutral button, not a grey fill', () => {
    render(<Button variant="secondary">Importar desde Excel</Button>)
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toEqual(expect.arrayContaining(['border', 'border-line-default', 'bg-surface-card', 'text-fg-primary']))
    expect(classes).not.toContain('bg-surface-icon-box')
  })

  it('sets the plain variant in the tint ink, with no ground and no edge', () => {
    render(<Button variant="plain">Ver todo</Button>)
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toEqual(expect.arrayContaining(['text-accent-blue-ink', 'bg-transparent', 'border-transparent']))
    // `.btn.t { padding: 0 8px }`, through the compound variant.
    expect(classes).toContain('px-2')
    expect(classes).not.toContain('px-3')
  })

  it('sets the link in the link ink, never the identity blue', () => {
    render(<Button variant="link">Abrir</Button>)
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toContain('text-accent-blue-ink')
    expect(classes).not.toContain('text-accent-blue')
  })

  it('draws destructive as the danger ink on the bordered button, never a red fill', () => {
    // White on the dark red fill (#ef4444) is 3.76:1, under 4.5:1; and HIG `buttons.md` keeps
    // the most prominent style off a destructive action.
    render(<Button variant="destructive">Eliminar</Button>)
    const classes = classesOf(screen.getByRole('button'))
    expect(classes).toEqual(expect.arrayContaining(['text-accent-red-ink', 'border-line-default', 'bg-surface-card']))
    expect(classes).not.toContain('bg-accent-red')
    expect(classes).not.toContain('text-fg-on-accent')
  })

  it('grows every size to the 44px hit region under a finger', () => {
    // HIG `buttons.md`: "a hit region of at least 44x44 pt". The desktop heights stay dense;
    // `pointer-coarse:` is the media query for a touch-first device.
    for (const size of ['default', 'sm', 'canvas'] as const) {
      expect(buttonVariants({ size }).split(/\s+/), size).toContain('pointer-coarse:min-h-11')
    }
    for (const size of ['icon', 'icon-canvas'] as const) {
      expect(buttonVariants({ size }).split(/\s+/), size).toContain('pointer-coarse:size-11')
    }
    // `lg` is already 44px.
    expect(buttonVariants({ size: 'lg' }).split(/\s+/)).toContain('h-11')
  })

  it('keeps 28px as the smallest desktop button', () => {
    render(<Button size="sm">Filtrar</Button>)
    expect(classesOf(screen.getByRole('button'))).toContain('h-control-md')
  })

  it('carries a press state on every variant, so a tap is acknowledged', () => {
    // HIG `buttons.md`: "Always include a press state for a custom button." `link` is text in
    // a sentence and underlines on hover instead.
    for (const variant of ['default', 'primary', 'destructive', 'outline', 'secondary', 'plain', 'ghost'] as const) {
      const classes = buttonVariants({ variant }).split(/\s+/)
      expect(classes.some((name) => name.startsWith('active:')), variant).toBe(true)
    }
  })
})
