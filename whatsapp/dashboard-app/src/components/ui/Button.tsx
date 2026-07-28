import { cn } from '@/lib/format'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'

type Props = Omit<HTMLMotionProps<'button'>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  loading?: boolean
  children?: ReactNode
}

const variants = {
  primary:
    'bg-primary text-white shadow-[0_10px_24px_rgba(15,159,178,0.28)] hover:brightness-105',
  secondary:
    'bg-white text-text border border-border hover:border-secondary hover:bg-[#f4fbfc]',
  ghost: 'bg-transparent text-muted hover:bg-white/70 hover:text-text',
  danger: 'bg-danger text-white hover:brightness-105',
}

const sizes = {
  sm: 'h-9 px-3 text-sm rounded-2xl',
  md: 'h-11 px-4 text-sm rounded-[18px]',
  lg: 'h-12 px-5 text-base rounded-[20px]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  return (
    <motion.button
      type={type as ButtonHTMLAttributes<HTMLButtonElement>['type']}
      whileHover={{ scale: disabled || loading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || loading ? 1 : 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-250 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className as string,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
      ) : (
        icon
      )}
      {children}
    </motion.button>
  )
}
