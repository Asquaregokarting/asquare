import { useEffect, useRef, useState } from 'react'
import {
  ATTACHMENT_LIMITS,
  AttachmentValidationError,
  uploadAttachment,
} from '../../api/ticket-attachments'
import type { TicketAttachment, TicketAttachmentKind } from '../../api/types'
import { logger } from '../../../lib/logger'

interface AttachmentUploaderProps {
  value: TicketAttachment[]
  onChange: (next: TicketAttachment[]) => void
  /**
   * A stable per-modal pending id used as the Storage path prefix until the
   * real ticket id is known. Caller passes a `useRef` value so it survives
   * re-renders.
   */
  ticketDraftId: string
}

type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping'

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export const AttachmentUploader = ({ value, onChange, ticketDraftId }: AttachmentUploaderProps) => {
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [recording, setRecording] = useState<RecordingState>('idle')
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const recordingTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const imageCount = value.filter((a) => a.kind === 'image').length
  const imagesFull = imageCount >= ATTACHMENT_LIMITS.maxImages

  const cleanupRecording = (): void => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (recordingTickRef.current) {
      clearInterval(recordingTickRef.current)
      recordingTickRef.current = null
    }
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    mediaRecorderRef.current = null
    recordedChunksRef.current = []
  }

  useEffect(() => {
    return () => {
      // On unmount, ensure any in-flight recorder + stream is released.
      const recorder = mediaRecorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          /* already stopped */
        }
      }
      cleanupRecording()
    }
  }, [])

  const handleUpload = async (file: File, kind: TicketAttachmentKind): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const attachment = await uploadAttachment({ ticketId: ticketDraftId, kind, file })
      onChange([...value, attachment])
    } catch (err) {
      if (err instanceof AttachmentValidationError) {
        setError(err.message)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        setError('Upload failed. Please try again.')
        logger.warn('ticket.attachment_upload_failed', { kind, error: msg })
      }
    } finally {
      setBusy(false)
    }
  }

  const onImagePicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (imagesFull) {
      setError(`Max ${ATTACHMENT_LIMITS.maxImages} images`)
      return
    }
    void handleUpload(file, 'image')
  }

  const onVideoPicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void handleUpload(file, 'video')
  }

  const stopRecording = (): void => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    if (recorder.state === 'inactive') return
    setRecording('stopping')
    try {
      recorder.stop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn('ticket.recorder_stop_failed', { error: msg })
      cleanupRecording()
      setRecording('idle')
    }
  }

  const startRecording = async (): Promise<void> => {
    if (recording !== 'idle') return
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Audio recording is not supported in this browser')
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this browser')
      return
    }
    setRecording('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Microphone permission denied')
      logger.warn('ticket.mic_permission_denied', { error: msg })
      setRecording('idle')
      return
    }
    streamRef.current = stream
    const mimeType =
      MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''
    let recorder: MediaRecorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Could not start recording')
      logger.warn('ticket.recorder_create_failed', { error: msg })
      cleanupRecording()
      setRecording('idle')
      return
    }
    mediaRecorderRef.current = recorder
    recordedChunksRef.current = []

    recorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data)
      }
    })
    recorder.addEventListener('stop', () => {
      const chunks = recordedChunksRef.current.slice()
      const finalMime = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type: finalMime })
      const ext = finalMime.includes('webm') ? 'webm' : 'm4a'
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: finalMime })
      cleanupRecording()
      setRecording('idle')
      setRecordingSeconds(0)
      if (file.size > 0) {
        void handleUpload(file, 'voice')
      }
    })

    try {
      recorder.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Could not start recording')
      logger.warn('ticket.recorder_start_failed', { error: msg })
      cleanupRecording()
      setRecording('idle')
      return
    }
    setRecording('recording')
    setRecordingSeconds(0)
    recordingTickRef.current = setInterval(() => {
      setRecordingSeconds((s) => s + 1)
    }, 1000)
    recordingTimerRef.current = setTimeout(() => {
      stopRecording()
    }, ATTACHMENT_LIMITS.maxVoiceSeconds * 1000)
  }

  const onRecordClick = (): void => {
    if (recording === 'recording') {
      stopRecording()
    } else if (recording === 'idle') {
      void startRecording()
    }
  }

  const removeAttachment = (id: string): void => {
    onChange(value.filter((a) => a.id !== id))
  }

  const recordButtonLabel =
    recording === 'recording'
      ? `Stop (${recordingSeconds}s)`
      : recording === 'requesting'
        ? 'Requesting…'
        : recording === 'stopping'
          ? 'Saving…'
          : 'Record voice'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={busy || imagesFull}
          className="ui-btn ui-btn-neutral text-xs"
        >
          {imagesFull ? `Images full (${ATTACHMENT_LIMITS.maxImages})` : 'Add image'}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Attach image"
          onChange={onImagePicked}
        />

        <button
          type="button"
          onClick={onRecordClick}
          disabled={busy || recording === 'requesting' || recording === 'stopping'}
          className="ui-btn ui-btn-neutral text-xs"
        >
          {recordButtonLabel}
        </button>

        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={busy}
          className="ui-btn ui-btn-neutral text-xs"
        >
          Add video
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          aria-label="Attach video"
          onChange={onVideoPicked}
        />

        {busy ? <span className="text-xs text-muted">Uploading…</span> : null}
        {error ? <span className="text-xs text-critical">{error}</span> : null}
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-2 py-1 text-xs text-text"
            >
              {a.kind === 'image' ? (
                <img src={a.url} alt="attachment" className="h-10 w-10 rounded object-cover" />
              ) : a.kind === 'voice' ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption -- voice attachments are user recordings without captions
                <audio src={a.url} controls className="h-8 max-w-[180px]" />
              ) : (
                // eslint-disable-next-line jsx-a11y/media-has-caption -- video attachments are user recordings without captions
                <video src={a.url} controls className="h-12 max-w-[200px] rounded" />
              )}
              <span className="text-muted">{formatSize(a.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                className="text-critical underline-offset-2 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
