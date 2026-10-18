import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}

export function Button({ children, variant = 'secondary', className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`assist-button assist-button-${variant} ${className}`.trim()} {...props}>{children}</button>;
}
