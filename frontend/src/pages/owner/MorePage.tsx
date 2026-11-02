import { Link } from 'react-router-dom'

const ITEMS = [
  { to: '/pemilik/konflik', title: 'Konflik data', text: 'Data bentrok yang sudah lewat batas waktu pekerja' },
  { to: '/pemilik/kandang', title: 'Kandang & flock', text: 'Tambah dan ubah kandang, mulai atau akhiri flock' },
  { to: '/pemilik/pengguna', title: 'Pengguna', text: 'Akun pekerja dan pemilik, ganti password' },
]

/** Pages the owner uses less often, so the menu still fits on a phone. */
export default function MorePage() {
  return (
    <>
      <h1>Lainnya</h1>
      {ITEMS.map((item) => (
        <Link key={item.to} to={item.to} className="house-button">
          <span>
            <span className="house-button__name">{item.title}</span>
            <br />
            <span className="muted">{item.text}</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      ))}
    </>
  )
}
