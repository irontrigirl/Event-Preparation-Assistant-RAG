'use client'

// Handles a known dev server race condition where dynamic chunks imported by
// next/dynamic haven't been compiled yet and cause a ChunkLoadError.

import { useEffect } from 'react'

export function ChunkLoadErrorHandler() {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      if (
        event.error?.name === 'ChunkLoadError' ||
        event.error?.message?.includes('Loading chunk')
      ) {
        event.preventDefault()
        window.location.reload()
      }
    }
    window.addEventListener('error', handler)
    return () => window.removeEventListener('error', handler)
  }, [])

  return null
}
