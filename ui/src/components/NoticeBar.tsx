interface NoticeBarProps {
  text: string;
  level?: 'info' | 'warning' | 'error';
  code?: string;
}

export function NoticeBar({ text, level = 'info', code = 'notice' }: NoticeBarProps) {
  return <div className={`notice notice-${level}`} role="status" data-testid={`notice-${code}`}>{text}</div>;
}
