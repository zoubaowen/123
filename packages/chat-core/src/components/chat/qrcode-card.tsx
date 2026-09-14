import { useEffect, useRef, useState } from 'react'
import { QrCode } from 'lucide-react'

interface QrCodeCardProps {
  url: string
  title?: string
  size?: number
  className?: string
}

export function QrCodeCard({ url, title, size = 200, className = '' }: QrCodeCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pngUrl, setPngUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import('qrcode')
      .then((QRCode) => {
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        QRCode.toCanvas(canvas, url, { width: size, margin: 2 }, (err: Error | null | undefined) => {
          if (err) {
            setError(err.message)
          } else {
            setPngUrl(canvas.toDataURL())
          }
        })
      })
      .catch(() => {
        setError('Failed to load QR code library')
      })
    return () => {
      cancelled = true
    }
  }, [url, size])

  return (
    <div className={`inline-flex flex-col items-center gap-2 p-3 border border-border rounded-lg bg-card ${className}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <QrCode className="h-3.5 w-3.5" />
        <span>{title ?? 'QR Code'}</span>
      </div>
      <div className="relative" style={{ width: size, height: size }}>
        <canvas ref={canvasRef} className="hidden" width={size} height={size} />
        {pngUrl ? (
          <img src={pngUrl} alt={`QR code for ${url}`} className="rounded" width={size} height={size} />
        ) : error ? (
          <div className="flex items-center justify-center w-full h-full text-xs text-destructive border rounded">
            {error}
          </div>
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-muted rounded animate-pulse" />
        )}
      </div>
      <p className="text-[10px] text-muted-foreground text-center break-all max-w-[200px] leading-tight">{url}</p>
    </div>
  )
}
