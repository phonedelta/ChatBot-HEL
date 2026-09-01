import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/format'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const field =
  'w-full rounded-[18px] border border-border bg-white px-4 py-3 text-sm text-text outline-none transition duration-250 placeholder:text-muted/70 focus:border-primary focus:ring-4 focus:ring-primary/10'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-28 resize-y', className)} {...props} />
}

export function Label({
  children,
  htmlFor,
  required,
}: {
  children: ReactNode
  htmlFor?: string
  required?: boolean
}) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-text">
      {children}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
  )
}

export function Field({
  label,
  id: idProp,
  name,
  children,
  hint,
  error,
  required,
}: {
  label: string
  id?: string
  name?: string
  children: ReactNode
  hint?: string
  error?: string
  required?: boolean
}) {
  const autoId = useId().replace(/:/g, '')
  const id = idProp || autoId
  const errorId = `${id}-error`
  const hintId = hint ? `${id}-hint` : undefined
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  const childArray = Children.toArray(children)
  const firstControl = childArray.find((c) => isValidElement(c)) as ReactElement | undefined
  const rest = childArray.filter((c) => c !== firstControl)

  const control = firstControl
    ? cloneElement(firstControl, {
        id,
        name: name || (firstControl.props as { name?: string }).name || id,
        required: required || (firstControl.props as { required?: boolean }).required,
        'aria-required': required || undefined,
        'aria-invalid': error ? true : (firstControl.props as { 'aria-invalid'?: boolean })['aria-invalid'],
        'aria-describedby': describedBy || (firstControl.props as { 'aria-describedby'?: string })['aria-describedby'],
        className: cn(
          (firstControl.props as { className?: string }).className,
          error && 'border-danger focus:border-danger focus:ring-danger/10',
        ),
      } as Record<string, unknown>)
    : children

  return (
    <div>
      <Label htmlFor={id} required={required}>{label}</Label>
      {control}
      {rest}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!error && hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-[var(--color-muted-accessible)]">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
