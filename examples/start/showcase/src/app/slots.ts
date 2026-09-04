import { slotsKey, useContextKey } from '@tanstack/react-compose'
import { useEffect } from 'react'
import type { AnySlot } from '@tanstack/react-compose'

/** Declare the slots an ordinary React component currently renders. */
export function useDeclareSlots(slots: ReadonlyArray<AnySlot>): void {
  const registry = useContextKey(slotsKey)
  useEffect(() => {
    if (!registry) return undefined
    const cleanups = slots.map((slot) => registry.declare(slot))
    return () => {
      for (const cleanup of cleanups) void cleanup()
    }
  }, [registry, slots])
}
