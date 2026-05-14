/**
 * Incharge Tasks API facade.
 * Thin wrapper over the Firestore module so feature code imports a stable shape.
 */

import {
  completePhotoTask,
  completeVehicleReport,
  getInchargeForToday,
  isInchargeComplete,
  isPhotoTaskComplete,
  isVehicleReportComplete,
  listInchargeTasksForRange,
  subscribeInchargeTasksForToday,
  type InchargeDailyRecord,
  type InchargeKartCondition,
  type InchargePhotoTask,
  type InchargeTaskKey,
  type InchargeVehicleReport,
  type InchargeVehicleReportEntry,
} from "./incharge-tasks-firestore";

export const inchargeTasksApi = {
  subscribeForToday: subscribeInchargeTasksForToday,
  getForToday: getInchargeForToday,
  listForRange: listInchargeTasksForRange,
  completePhotoTask,
  completeVehicleReport,
  isComplete: isInchargeComplete,
  isPhotoTaskComplete,
  isVehicleReportComplete,
};

export type {
  InchargeDailyRecord,
  InchargeKartCondition,
  InchargePhotoTask,
  InchargeTaskKey,
  InchargeVehicleReport,
  InchargeVehicleReportEntry,
};

export { INCHARGE_PHOTO_MIN } from "./incharge-tasks-firestore";
