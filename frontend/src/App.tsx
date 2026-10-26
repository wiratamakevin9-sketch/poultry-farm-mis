import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './auth/useSession'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HousesPage from './pages/owner/HousesPage'
import OwnerConflictsPage from './pages/owner/OwnerConflictsPage'
import RecordsPage from './pages/owner/RecordsPage'
import UsersPage from './pages/owner/UsersPage'
import WorkerApp from './pages/worker/WorkerApp'

const OWNER_LINKS = [
  { to: '/pemilik/catatan', label: 'Catatan' },
  { to: '/pemilik/konflik', label: 'Konflik' },
  { to: '/pemilik/kandang', label: 'Kandang' },
  { to: '/pemilik/pengguna', label: 'Pengguna' },
]

export default function App() {
  const session = useSession()

  if (!session) return <LoginPage />

  if (session.user.role === 'OWNER') {
    return (
      <Layout user={session.user} links={OWNER_LINKS}>
        <Routes>
          <Route path="/pemilik/catatan" element={<RecordsPage />} />
          <Route path="/pemilik/konflik" element={<OwnerConflictsPage />} />
          <Route path="/pemilik/kandang" element={<HousesPage />} />
          <Route path="/pemilik/pengguna" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/pemilik/catatan" replace />} />
        </Routes>
      </Layout>
    )
  }

  return <WorkerApp user={session.user} />
}
