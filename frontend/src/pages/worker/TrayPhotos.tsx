import PhotoPicker from '../../components/PhotoPicker'
import PhotoThumb from '../../components/PhotoThumb'
import type { LocalPhoto, TrayCategory } from '../../db/db'
import type { CompressedPhoto } from '../../lib/image'
import { TRAY_LABELS } from '../../lib/labels'

/** A photo taken in the form but not saved yet. */
export interface NewTrayPhoto {
  key: string
  category: TrayCategory
  photo: CompressedPhoto
}

interface Props {
  saved: LocalPhoto[]
  added: NewTrayPhoto[]
  onAdd: (category: TrayCategory, photo: CompressedPhoto) => void
  onRemoveAdded: (key: string) => void
  onRemoveSaved: (id: string) => void
  disabled: boolean
}

/** UC13: photos of the remainder tray and the sorted cracked and dirty trays. */
export default function TrayPhotos({
  saved,
  added,
  onAdd,
  onRemoveAdded,
  onRemoveSaved,
  disabled,
}: Props) {
  return (
    <section className="card stack" aria-labelledby="tray-photos">
      <div>
        <h2 id="tray-photos" style={{ marginBottom: 4 }}>
          Foto tray <span className="muted">– opsional</span>
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Foto tray terakhir telur bagus (yang tidak penuh) dan tray telur retak dan kotor
          yang sudah dipilah. Foto disimpan di HP dan dikirim saat ada sinyal.
        </p>
      </div>

      {(Object.keys(TRAY_LABELS) as TrayCategory[]).map((category) => (
        <div key={category} className="stack">
          {saved
            .filter((p) => p.tray_category === category)
            .map((p) => (
              <PhotoThumb
                key={p.id}
                photo={p}
                caption={TRAY_LABELS[category]}
                onRemove={() => onRemoveSaved(p.id)}
              />
            ))}
          {added
            .filter((p) => p.category === category)
            .map((p) => (
              <PhotoThumb
                key={p.key}
                photo={{
                  ...p.photo,
                  id: p.key,
                  kind: 'TRAY',
                  house_id: '',
                  taken_at: '',
                  status: 'pending',
                }}
                caption={TRAY_LABELS[category]}
                unsaved
                onRemove={() => onRemoveAdded(p.key)}
              />
            ))}
          <PhotoPicker
            label={`Foto ${TRAY_LABELS[category].toLowerCase()}`}
            onPhoto={(photo) => onAdd(category, photo)}
            disabled={disabled}
          />
        </div>
      ))}
    </section>
  )
}
