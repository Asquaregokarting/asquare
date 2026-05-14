import { useEffect, useState } from 'react'
import {
  HelicopterPublicConfig,
  subscribeHelicopterPublicConfig,
} from '../services/helicopterConfigService'

/**
 * Returns `{ enabled, ready, config }`.
 *  - `ready` is false until the first snapshot has arrived — use it to
 *    avoid flashing helicopter UI before the config is known.
 *  - `enabled` is the global master switch.
 */
export function useHelicopterEnabled() {
  const [config, setConfig] = useState<HelicopterPublicConfig | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeHelicopterPublicConfig(setConfig)
    return () => unsubscribe()
  }, [])

  return {
    ready: config !== null,
    enabled: config?.enabled !== false,
    config,
  }
}
