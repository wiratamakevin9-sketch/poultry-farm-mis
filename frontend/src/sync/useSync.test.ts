import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../api/client'
import { getDb } from '../db/db'
import { saveRecord } from '../db/records'
import { SYNC_INTERVAL_MS, useSync } from './useSync'

let n = 0
const freshDb = () => getDb(`hook-${++n}`)

afterEach(() => {
  vi.useRealTimers()
})

describe('useSync', () => {
  it('syncs on start, on the online event and on the timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const run = vi.fn().mockResolvedValue(undefined)
    const db = freshDb()
    renderHook(() => useSync(db, run))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))

    await act(async () => {
      vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(3))
  })

  it('shows offline without an error when the server is unreachable', async () => {
    const run = vi.fn().mockRejectedValue(new NetworkError())
    const db = freshDb()
    const { result } = renderHook(() => useSync(db, run))
    await waitFor(() => expect(result.current.online).toBe(false))
    expect(result.current.error).toBeNull()
  })

  it('counts records waiting to sync', async () => {
    const db = freshDb()
    const run = vi.fn().mockRejectedValue(new NetworkError())
    const { result } = renderHook(() => useSync(db, run))
    await act(async () => {
      await saveRecord(db, {
        house_id: 'h1',
        flock_id: 'f1',
        record_date: '2026-10-26',
        values: {
          eggs_good: 1, eggs_cracked: 0, eggs_rejected: 0, eggs_dirty: 0, feed_kg: 1,
          water_liters: null, dead: 0, culled: 0, notes: '',
        },
        user_id: 'u1',
      })
    })
    await waitFor(() => expect(result.current.pending).toBe(1))
  })

  it('manual sync runs the engine', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const db = freshDb()
    const { result } = renderHook(() => useSync(db, run))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await act(() => result.current.sync())
    expect(run).toHaveBeenCalledTimes(2)
  })
})
