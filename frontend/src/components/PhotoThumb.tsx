import { useEffect, useState } from 'react'
import type { LocalPhoto } from '../db/db'

const STATUS = {
  pending: { text: 'Menunggu dikirim', badge: 'warn' },
  uploaded: { text: 'Terkirim', badge: 'ok' },
  failed: { text: 'Gagal', badge: 'bad' },
} as const

interface Props {
  photo: LocalPhoto
  caption: string
  onRemove?: () => void
}

export default function PhotoThumb({ photo, caption, onRemove }: Props) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo.thumb)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [photo.thumb])

  const status = STATUS[photo.status]
  return (
    <figure className="photo-thumb">
      {url && <img src={url} alt={caption} width={photo.width} height={photo.height} />}
      <figcaption>
        <span>{caption}</span>
        <span className={`badge ${status.badge}`}>{status.text}</span>
        {photo.error && <span className="field-error">{photo.error}</span>}
        {onRemove && photo.status !== 'uploaded' && (
          <button type="button" className="small danger" onClick={onRemove}>
            Hapus foto
          </button>
        )}
      </figcaption>
    </figure>
  )
}
