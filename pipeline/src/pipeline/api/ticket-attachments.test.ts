import { describe, it, expect } from 'vitest'
import { validateAttachment, AttachmentValidationError } from './ticket-attachments'

const mockFile = (size: number, type: string, name = 'f.bin'): File => {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe('validateAttachment', () => {
  it('accepts a small image', () => {
    expect(() => validateAttachment(mockFile(1000, 'image/jpeg'), 'image')).not.toThrow()
  })
  it('rejects an oversize image', () => {
    expect(() => validateAttachment(mockFile(6 * 1024 * 1024, 'image/jpeg'), 'image')).toThrow(
      AttachmentValidationError,
    )
  })
  it('rejects a non-image when kind=image', () => {
    expect(() => validateAttachment(mockFile(100, 'application/pdf'), 'image')).toThrow(
      /not an image/,
    )
  })
  it('rejects an oversize video', () => {
    expect(() => validateAttachment(mockFile(11 * 1024 * 1024, 'video/mp4'), 'video')).toThrow(
      /too large/i,
    )
  })
  it('accepts webm voice', () => {
    expect(() => validateAttachment(mockFile(500_000, 'audio/webm'), 'voice')).not.toThrow()
  })
})
