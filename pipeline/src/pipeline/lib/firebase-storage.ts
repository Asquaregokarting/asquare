import { FirebaseStorage, getDownloadURL, getStorage, ref, uploadBytesResumable } from "firebase/storage";
import { ensureFirebaseAuthForStorage } from "./firebase-auth";
import { initializeFirebaseApp } from "./firebase";

const storageInstances = new Map<string, FirebaseStorage>();

const toSafePathPart = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeBucketName = (value: string): string => String(value ?? "").trim().replace(/^gs:\/\//i, "").replace(/\/+$/, "");

const getStorageBucketCandidates = (): string[] => {
  const configured = normalizeBucketName(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "");
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
  const candidates = new Set<string>();
  if (configured) {
    candidates.add(configured);
    if (configured.endsWith(".firebasestorage.app")) {
      candidates.add(`${configured.replace(/\.firebasestorage\.app$/i, "")}.appspot.com`);
    }
    if (configured.endsWith(".appspot.com")) {
      candidates.add(`${configured.replace(/\.appspot\.com$/i, "")}.firebasestorage.app`);
    }
  }
  if (projectId) {
    candidates.add(`${projectId}.firebasestorage.app`);
    candidates.add(`${projectId}.appspot.com`);
  }
  return [...candidates].filter((item) => item.length > 0);
};

const initializeFirebaseStorage = (bucket?: string): FirebaseStorage | null => {
  const bucketName = normalizeBucketName(bucket ?? "");
  const key = bucketName || "__default__";
  const existing = storageInstances.get(key);
  if (existing) {
    return existing;
  }

  const app = initializeFirebaseApp();
  if (!app) {
    return null;
  }

  const instance = bucketName ? getStorage(app, `gs://${bucketName}`) : getStorage(app);
  storageInstances.set(key, instance);
  return instance;
};

const uploadViaStorage = async (
  storage: FirebaseStorage,
  storagePath: string,
  file: File,
  kind: "images" | "files",
  safeTaskId: string
): Promise<{ downloadUrl: string; storagePath: string }> => {
  const fileRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(fileRef, file, {
    contentType: file.type || undefined,
    customMetadata: {
      originalName: file.name,
      taskId: safeTaskId,
      kind
    }
  });

  await new Promise<void>((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      undefined,
      (error) => reject(error),
      () => resolve()
    );
  });

  const downloadUrl = await getDownloadURL(fileRef);
  return { downloadUrl, storagePath };
};

export const uploadTaskChatFile = async (
  taskId: string,
  file: File,
  kind: "images" | "files"
): Promise<{
  downloadUrl: string;
  storagePath: string;
}> => {
  await ensureFirebaseAuthForStorage();

  const safeTaskId = toSafePathPart(taskId, "task");
  const safeFileName = toSafePathPart(file.name, "upload.bin");
  const fileKey = randomId("chat");
  const storagePath = `task-chat/${safeTaskId}/${kind}/${fileKey}-${safeFileName}`;
  const bucketCandidates = getStorageBucketCandidates();
  const normalizedCandidates = bucketCandidates.length > 0 ? bucketCandidates : [""];

  let lastError: unknown = null;
  for (const bucket of normalizedCandidates) {
    const storage = initializeFirebaseStorage(bucket);
    if (!storage) {
      lastError = new Error("File storage is not configured.");
      continue;
    }
    try {
      return await uploadViaStorage(storage, storagePath, file, kind, safeTaskId);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("File upload failed.");
};

export const uploadPipelineFile = async (
  storagePath: string,
  file: File,
  kind: "images" | "files" = "files"
): Promise<{
  downloadUrl: string;
  storagePath: string;
}> => {
  await ensureFirebaseAuthForStorage();

  const normalizedPath = String(storagePath ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!normalizedPath) {
    throw new Error("Storage path is required.");
  }

  const bucketCandidates = getStorageBucketCandidates();
  const normalizedCandidates = bucketCandidates.length > 0 ? bucketCandidates : [""];

  let lastError: unknown = null;
  for (const bucket of normalizedCandidates) {
    const storage = initializeFirebaseStorage(bucket);
    if (!storage) {
      lastError = new Error("File storage is not configured.");
      continue;
    }
    try {
      return await uploadViaStorage(storage, normalizedPath, file, kind, "pipeline");
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("File upload failed.");
};
