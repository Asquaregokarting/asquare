import {
  DEFAULT_BOOKING_CONFIRMATION_CONFIG,
  getBookingConfirmationConfig,
  updateBookingConfirmationConfig,
} from './booking-confirmation-config-firestore'
import type { BookingConfirmationConfig } from './types'

export type { BookingConfirmationConfig }
export { DEFAULT_BOOKING_CONFIRMATION_CONFIG }

export const bookingConfirmationConfigApi = {
  get(): Promise<BookingConfirmationConfig> {
    return getBookingConfirmationConfig()
  },
  update(
    token: string,
    patch: Partial<
      Pick<BookingConfirmationConfig, 'defaultTemplateId' | 'defaultTemplateLanguage'>
    >,
  ): Promise<BookingConfirmationConfig> {
    return updateBookingConfirmationConfig(token, patch)
  },
}
