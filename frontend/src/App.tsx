import { Navigate, Route, Routes } from 'react-router-dom'
import type { SessionUser } from './auth/storage'
import { useSession } from './auth/useSession'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import HousesPage from './pages/owner/HousesPage'
import MorePage from './pages/owner/MorePage'
import OwnerHealthDetail from './pages/owner/OwnerHealthDetail'
import OwnerHealthPage from './pages/owner/OwnerHealthPage'
import OwnerConflictsPage from './pages/owner/OwnerConflictsPage'
import RecordsPage from './pages/owner/RecordsPage'
import SchedulePage from './pages/owner/SchedulePage'
import UsersPage from './pages/owner/UsersPage'
import { useNewHealthCount } from './pages/owner/useNewHealthCount'
import WorkerApp from './pages/worker/WorkerApp'


export default function App() {
  const session = useSession()

  if (!session) return <LoginPage />

  if (session.user.role === 'OWNER') return <OwnerApp user={session.user} />
  return <WorkerApp user={session.user} />
}

function OwnerApp({ user }: { user: SessionUser }) {
  const newHealth = useNewHealthCount()
  const links = [
    { to: '/pemilik/catatan', label: 'Catatan' },
    {
      to: '/pemilik/kesehatan',
      label: (
        <>
          Kesehatan
          {newHealth > 0 && <span className="nav-badge">Baru {newHealth}</span>}
        </>
      ),
    },
    { to: '/pemilik/jadwal', label: 'Jadwal' },
    { to: '/pemilik/lainnya', label: 'Lainnya' },
  ]
  return (
    <Layout user={user} links={links}>
      <Routes>
        <Route path="/pemilik/catatan" element={<RecordsPage />} />
        <Route path="/pemilik/konflik" element={<OwnerConflictsPage />} />
        <Route path="/pemilik/kesehatan" element={<OwnerHealthPage />} />
        <Route path="/pemilik/kesehatan/:id" element={<OwnerHealthDetail />} />
        <Route path="/pemilik/jadwal" element={<SchedulePage />} />
        <Route path="/pemilik/lainnya" element={<MorePage />} />
        <Route path="/pemilik/kandang" element={<HousesPage />} />
        <Route path="/pemilik/pengguna" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/pemilik/catatan" replace />} />
      </Routes>
    </Layout>
  )
}
