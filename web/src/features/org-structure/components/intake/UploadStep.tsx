import { useId, useRef, useState, type DragEvent } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Button } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'

/**
 * Step 1: the client's own spreadsheet, dropped or chosen. The template is still offered, but as
 * the secondary road — the point of this step is that nobody has to retype their HR export into
 * our layout first.
 *
 * The drop zone is a plain `div`, never a `<button>` (`index.css` cards every bare button), and
 * it is not itself focusable: the keyboard path is the real `Button` inside it, which opens the
 * hidden native input. Dropping is a pointer convenience on top of that, not the only way in.
 */
export function UploadStep({
  busy,
  fileName,
  onFile,
  onDownloadTemplate,
}: {
  busy: boolean
  fileName: string | null
  onFile: (file: File) => void
  onDownloadTemplate: () => void
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function accept(file: File | undefined) {
    if (file && !busy) onFile(file)
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!dragging) setDragging(true)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files[0])
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-slot="intake-dropzone"
        data-dragging={dragging || undefined}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        // `relative`: the `sr-only` input inside is absolutely positioned, and with no positioned
        // ancestor it escapes to the page and can widen it at phone width.
        className={cn(
          'relative flex flex-col items-center gap-3 rounded-xl border border-dashed px-5 py-8 text-center transition-colors',
          dragging ? 'border-accent-blue bg-accent-blue-soft' : 'border-line-default bg-surface-card',
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-12 items-center justify-center rounded-xl bg-surface-icon-box text-fg-secondary [&_svg]:size-6"
        >
          <FileSpreadsheet />
        </span>
        <div className="flex max-w-prose flex-col gap-1">
          <p className="m-0 text-xl font-semibold text-fg-primary">{t('users.intake.upload.title')}</p>
          <p className="m-0 text-sm leading-normal text-fg-secondary">{t('users.intake.upload.body')}</p>
        </div>
        <label htmlFor={inputId} className="sr-only">
          {t('users.intake.upload.inputLabel')}
        </label>
        {/* The native control is not drawn: its "Choose File / No file chosen" is written by the
            browser in the browser's own language, which put English on a Spanish screen. */}
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            accept(event.target.files?.[0])
            // Cleared so choosing the same file again, after a fix in Excel, still uploads it.
            event.target.value = ''
          }}
        />
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <Button type="button" variant="primary" size="canvas" onClick={() => input.current?.click()} disabled={busy}>
            <Upload aria-hidden="true" className="size-4" />
            {t('users.intake.upload.choose')}
          </Button>
          <span className="text-sm text-fg-tertiary">
            {dragging ? t('users.intake.upload.dropActive') : t('users.intake.upload.dropHint')}
          </span>
        </div>
        {fileName && (
          <p className="m-0 max-w-full truncate text-sm font-medium text-fg-primary">
            {t('users.intake.upload.chosen', { name: fileName })}
          </p>
        )}
        <p className="m-0 text-xs text-fg-tertiary">{t('users.intake.upload.formats')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
        <span>{t('users.intake.upload.templatePrompt')}</span>
        <Button type="button" variant="link" onClick={onDownloadTemplate} disabled={busy}>
          <Download aria-hidden="true" className="size-4" />
          {t('users.intake.upload.templateAction')}
        </Button>
      </div>
    </div>
  )
}
