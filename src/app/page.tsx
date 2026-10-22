import { Suspense } from 'react'
import { getDashboardData } from '@/lib/dashboard-data'
import { ControlPlaneDashboard } from '@/components/control-plane-dashboard'

async function DashboardContent() {
  const initialData = await getDashboardData()
  return <ControlPlaneDashboard initialData={initialData} />
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400 font-mono text-sm">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-500"></span>
            </span>
            <span>Initializing Control Plane Mesh & Database State...</span>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  )
}
