import { useId, useState, type ChangeEvent } from 'react'
import { compressPhoto, type CompressedPhoto } from '../lib/image'

interface Props {
  label: string
  onPhoto: (photo: CompressedPhoto) => Promise<void> | void
  disabled?: boolean
}

/** Opens the back camera on a phone (or the file picker on a computer). Works offline. */
export default function PhotoPicker({ label, onPhoto, disabled = false }: Props) {
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function change(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // allow taking another photo with the same input
    if (!file) return
    setError('')
    setBusy(true)
    try {
      await onPhoto(await compressPhoto(file))
    } catch {
      setError('Foto tidak bisa diproses. Coba ambil foto lagi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <label htmlFor={id} className={`button secondary ${disabled || busy ? 'is-disabled' : ''}`}>
        {busy ? 'Memproses foto…' : label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        onChange={change}
        disabled={disabled || busy}
      />
      {error && <span className="field-error">{error}</span>}
    </div>
  )
}
