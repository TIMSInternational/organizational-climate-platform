// Batch 1 of the ui/ primitive port (#75): forms and core layout.
export { Button, type ButtonProps } from './button'
export { buttonVariants, type ButtonVariantProps } from './buttonVariants'
export { Badge, type BadgeProps } from './badge'
export { badgeVariants, type BadgeVariantProps } from './badgeVariants'
// The status chip (UI-0). Beside `Badge`, not instead of it — `chip.tsx` says why.
export { Chip, type ChipProps } from './chip'
export { chipVariants, type ChipTone, type ChipVariantProps } from './chipVariants'
export { Input, type InputProps } from './input'
export { Textarea, type TextareaProps } from './textarea'
export { Label, type LabelProps } from './label'
export { Checkbox, type CheckboxProps } from './checkbox'
export { RadioGroup, RadioGroupItem } from './radio-group'
export { Switch, type SwitchProps } from './switch'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'
export {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  type FormItemProps,
} from './form'
export { useFormField, type FormItemContextValue } from './formContext'
export {
  CheckboxField,
  RadioField,
  SelectField,
  SwitchField,
  TextField,
  TextareaField,
  type CheckboxFieldProps,
  type FieldOption,
  type RadioFieldProps,
  type SelectFieldProps,
  type SwitchFieldProps,
  type TextFieldProps,
  type TextareaFieldProps,
} from './FormField'
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'
export { Separator, type SeparatorProps } from './separator'
export {
  Body,
  BodySmall,
  Caption,
  Code,
  DataText,
  H1,
  H2,
  H3,
  H4,
  SectionLabel,
  Typography,
  type TypographyProps,
} from './typography'
export { typographyVariants, type TypographyVariant } from './typographyVariants'
export { Avatar, AvatarFallback, AvatarImage } from './avatar'

// Batch 2 of the ui/ primitive port (#76): overlays and feedback.
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  type DialogContentProps,
} from './dialog'
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
export { ConfirmationDialog, type ConfirmationDialogProps } from './confirmation-dialog'
export { SuccessDialog, type SuccessDialogProps } from './success-dialog'
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  type SheetContentProps,
} from './sheet'
export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './popover'
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './dropdown-menu'
export { Toaster, type ToasterProps } from './toast'
// Re-exported from sonner directly: `toast` is an imperative function, and
// re-exporting it from toast.tsx would make that file export a non-component.
export { toast } from 'sonner'
export { resolveToasterTheme } from './toasterTheme'
export { Alert, AlertDescription, AlertTitle, type AlertProps } from './alert'
export { alertVariants, type AlertVariantProps } from './alertVariants'
export { Skeleton, SkeletonText } from './skeleton'
export { LoadingRegion, Spinner, type LoadingRegionProps, type SpinnerProps } from './spinner'
export { Progress, type ProgressProps } from './progress'
export {
  EmptyState,
  ErrorState,
  NetworkError,
  type ErrorStateProps,
  type NetworkErrorProps,
} from './error-state'

// Batch 3 of the ui/ primitive port (#77): data display and navigation.
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableEmpty,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHeader,
  type SortDirection,
} from './table'
export { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion'
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'
export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb'
export { ScrollArea, ScrollBar } from './scroll-area'
export { Slider, type SliderProps } from './slider'
export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination'
export { usePagination, type PaginationRange } from './usePagination'
export {
  NotificationDropdown,
  type NotificationDropdownProps,
  type NotificationItem,
} from './notification-dropdown'
export { SkipLink } from './skip-link'
export { LiveRegion, type LiveRegionProps } from './live-region'

// Date selection (#77 follow-up: originally skipped, ported with locale wiring).
export { Calendar, type CalendarProps } from './calendar'
export { DatePicker, type DatePickerProps } from './date-picker'
