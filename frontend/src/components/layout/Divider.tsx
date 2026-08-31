// A hairline that fades out at both ends, used to separate the page's sections.
export function Divider({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-px w-full bg-gradient-to-r from-transparent via-violet-300/25 to-transparent ${className}`}
    />
  )
}
