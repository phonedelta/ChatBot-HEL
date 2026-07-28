import { cn } from '@/lib/format'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

type Props = {
  children: ReactNode
  className?: string
  hover?: boolean
  padding?: string
}

export function Card({ children, className, hover = true, padding = 'p-6' }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn('card-surface', padding, hover && 'hover:-translate-y-0.5', className)}
    >
      {children}
    </motion.div>
  )
}
