import { type ReactNode } from 'react'
import { motion, type Variants } from 'motion/react'

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
}

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
}

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: 'easeOut' } },
}

const slideInRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
}

interface AnimatedItemProps {
  children: ReactNode
  className?: string
  variant?: 'fadeInUp' | 'fadeIn' | 'scaleIn' | 'slideInRight'
  delay?: number
  layout?: boolean
}

const variants: Record<string, Variants> = {
  fadeInUp,
  fadeIn,
  scaleIn,
  slideInRight,
}

export function AnimatedItem({
  children,
  className = '',
  variant = 'fadeInUp',
  delay = 0,
  layout = false,
}: AnimatedItemProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={variants[variant]}
      transition={{ delay }}
      layout={layout}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function AnimatedList({
  children,
  className = '',
  staggerDelay = 0.04,
}: {
  children: ReactNode
  className?: string
  staggerDelay?: number
}) {
  return <div className={className}>{children}</div>
}

export { motion }
