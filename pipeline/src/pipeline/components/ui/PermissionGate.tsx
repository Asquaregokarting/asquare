/**
 * PermissionGate — reusable component that wraps a feature requiring
 * a native permission. Shows a pre-permission explanation, requests
 * the permission, and handles denied/blocked states with retry and
 * "Open Settings" guidance.
 *
 * Usage:
 *   <PermissionGate type="camera" onGranted={() => ...} onClose={() => ...} />
 */

import { useState } from 'react'
import {
  PERMISSION_INFO,
  requestPermission,
  type PermissionResult,
  type PermissionType,
} from '../../../lib/native-permissions'
import { getCurrentPlatform } from '../../../lib/platform'

interface PermissionGateProps {
  /** Which permission to request. */
  type: PermissionType
  /** Called when permission is granted. */
  onGranted: () => void
  /** Called when the user dismisses the gate without granting. */
  onClose: () => void
}

type GateState = 'explain' | 'requesting' | 'denied' | 'blocked'

const ICON_PATHS: Record<string, string> = {
  camera:
    'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image:
    'M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM21 19H3l4.5-6 3 4 4.5-6 6 8z',
  'map-pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z M13.73 21a2 2 0 0 1-3.46 0',
}

export const PermissionGate = ({ type, onGranted, onClose }: PermissionGateProps) => {
  const [state, setState] = useState<GateState>('explain')
  const [attemptCount, setAttemptCount] = useState(0)
  const info = PERMISSION_INFO[type]
  const platform = getCurrentPlatform()
  const isNative = platform === 'android' || platform === 'ios'

  const handleRequest = async () => {
    setState('requesting')

    const result: PermissionResult = await requestPermission(type)

    if (result === 'granted') {
      onGranted()
      return
    }

    setAttemptCount((c) => c + 1)

    // If denied twice or more, treat as "blocked" (permanently denied)
    if (attemptCount >= 1) {
      setState('blocked')
    } else {
      setState('denied')
    }
  }

  const settingsHint = isNative
    ? platform === 'android'
      ? 'Open your device Settings > Apps > A Square GoKarting > Permissions and enable this permission.'
      : 'Open Settings > A Square GoKarting and enable this permission.'
    : "Check your browser's site settings to enable this permission."

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-base/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-panel p-6 shadow-xl">
        {/* Icon */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={ICON_PATHS[info.icon] ?? ICON_PATHS.camera} />
          </svg>
        </div>

        {/* Title */}
        <h3 className="mt-4 text-center font-display text-xl font-bold text-text">
          {state === 'blocked'
            ? 'Permission Blocked'
            : state === 'denied'
              ? 'Permission Denied'
              : info.title}
        </h3>

        {/* Body */}
        <p className="mt-2 text-center text-sm text-muted">
          {state === 'explain' && info.reason}
          {state === 'requesting' && 'Requesting permission...'}
          {state === 'denied' && `${info.reason} Please allow access when prompted.`}
          {state === 'blocked' && settingsHint}
        </p>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2">
          {state === 'explain' && (
            <button
              type="button"
              onClick={() => void handleRequest()}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white"
            >
              Allow {info.title}
            </button>
          )}

          {state === 'requesting' && (
            <div className="flex justify-center py-3">
              <svg className="size-6 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}

          {state === 'denied' && (
            <button
              type="button"
              onClick={() => void handleRequest()}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white"
            >
              Try Again
            </button>
          )}

          {state === 'blocked' && isNative && (
            <button
              type="button"
              onClick={() => {
                // On Capacitor, we can't programmatically open settings,
                // but the user now has clear instructions.
                onClose()
              }}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white"
            >
              I Understand
            </button>
          )}

          {state === 'blocked' && !isNative && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white"
            >
              I Understand
            </button>
          )}

          {state !== 'requesting' && (
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-border/60 bg-surface px-4 py-3 text-sm font-semibold text-muted"
            >
              {state === 'explain' ? 'Not Now' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
