import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { getStorage } from 'firebase/storage'
import { getApp } from 'firebase/app'
import type { TicketAttachment, TicketAttachmentKind } from './types'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VOICE_BYTES = 2 * 1024 * 1024
const MAX_VIDEO_BYTES = 10 * 1024 * 1024
const MAX_VOICE_SECONDS = 30

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentValidationError'
  }
}

export function validateAttachment(file: File, kind: TicketAttachmentKind): void {
  if (kind === 'image' && !file.type.startsWith('image/')) {
    throw new AttachmentValidationError('File is not an image')
  }
  if (kind === 'voice' && !(file.type.startsWith('audio/') || file.type === 'video/webm')) {
    throw new AttachmentValidationError('File is not an audio recording')
  }
  if (kind === 'video' && !file.type.startsWith('video/')) {
    throw new AttachmentValidationError('File is not a video')
  }
  const max =
    kind === 'image' ? MAX_IMAGE_BYTES : kind === 'voice' ? MAX_VOICE_BYTES : MAX_VIDEO_BYTES
  if (file.size > max) {
    throw new AttachmentValidationError(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
    )
  }
}

export interface UploadOptions {
  ticketId: string
  kind: TicketAttachmentKind
  file: File
}

export async function uploadAttachment(opts: UploadOptions): Promise<TicketAttachment> {
  validateAttachment(opts.file, opts.kind)
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ext = opts.file.name.split('.').pop() || 'bin'
  const path = `tickets/${opts.ticketId}/${id}.${ext}`
  const storageRef = ref(getStorage(getApp()), path)
  await uploadBytes(storageRef, opts.file, { contentType: opts.file.type })
  const url = await getDownloadURL(storageRef)
  return {
    id,
    kind: opts.kind,
    storagePath: path,
    url,
    sizeBytes: opts.file.size,
    mimeType: opts.file.type,
    uploadedAt: new Date().toISOString(),
  }
}

export const ATTACHMENT_LIMITS = {
  maxImages: 5,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxVoiceBytes: MAX_VOICE_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
  maxVoiceSeconds: MAX_VOICE_SECONDS,
} as const
