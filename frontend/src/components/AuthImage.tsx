import { useEffect, useState } from 'react'
import { apiBlob } from '../api/client'

/** An <img> for a photo that needs the login token, which a plain src cannot send. */
export default function AuthImage({ photoId, alt }: { photoId: string; alt: string }) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | undefined
    let cancelled = false
    apiBlob(`/photos/${photoId}/file`).then(
      (blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      },
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoId])

  if (failed) return <div className="alert">Foto tidak bisa dimuat.</div>
  if (!url) return <div className="photo-placeholder" aria-label="Memuat foto" />
  return <img className="photo-full" src={url} alt={alt} />
}
