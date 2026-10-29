import { useMemo } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { SessionUser } from '../../auth/storage'
import Layout from '../../components/Layout'
import SyncStatus from '../../components/SyncStatus'
import { getDb } from '../../db/db'
import { WorkerProvider, useWorker } from '../../sync/WorkerContext'
import ConflictsPage from './ConflictsPage'
import HealthForm from './HealthForm'
import HealthList from './HealthList'
import RecordForm from './RecordForm'
import WorkerHome from './WorkerHome'

function WorkerShell() {
  const { user, sync } = useWorker()
  const warning =
    sync.pending > 0
      ? `Ada ${sync.pending} data yang belum terkirim. Data tetap aman di HP ini dan ` +
        'akan dikirim setelah Anda login lagi.'
      : undefined
  return (
    <Layout user={user} links={[]} status={<SyncStatus />} logoutWarning={warning}>
      <Routes>
        <Route path="/" element={<WorkerHome />} />
        <Route path="/catat/:houseId/:date" element={<RecordForm />} />
        <Route path="/konflik" element={<ConflictsPage />} />
        <Route path="/kesehatan" element={<HealthList />} />
        <Route path="/kesehatan/baru" element={<HealthForm />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function WorkerApp({ user }: { user: SessionUser }) {
  const db = useMemo(() => getDb(user.id), [user.id])
  return (
    <WorkerProvider user={user} db={db}>
      <WorkerShell />
    </WorkerProvider>
  )
}
