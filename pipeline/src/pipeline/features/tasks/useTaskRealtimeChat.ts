import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tasksApi } from "../../api/tasks";
import { uploadTaskChatFile } from "../../lib/firebase-storage";
import {
  TaskConversationActivityRecord,
  TaskConversationSnapshot,
  TaskMessageRecord,
  TaskOutgoingMessagePayload,
  TaskPollOptionRecord,
  TaskReadReceiptRecord,
  TaskTypingRecord
} from "../../api/types";

const TYPING_IDLE_MS = 1200;
const TYPING_STALE_MS = 15000;
const MAX_CHAT_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_RAW_IMAGE_BYTES = 35 * 1024 * 1024;
const IMAGE_COMPRESSION_TRIGGER_BYTES = 2 * 1024 * 1024;
const IMAGE_COMPRESSED_TARGET_BYTES = 1200 * 1024;
const IMAGE_MAX_DIMENSION = 1920;
const UPLOAD_TIMEOUT_MS = 120_000;
const UPLOAD_RETRY_TIMEOUT_MS = 180_000;

const emptyConversationSnapshot = (taskId?: string): TaskConversationSnapshot => ({
  taskId: taskId ?? "",
  messages: [],
  activities: [],
  typing: [],
  readReceipts: []
});

const sortMessages = (messages: TaskMessageRecord[]): TaskMessageRecord[] =>
  [...messages].sort((left, right) => {
    const leftKey = left.createdAt || left.clientCreatedAt || "";
    const rightKey = right.createdAt || right.clientCreatedAt || "";
    if (leftKey === rightKey) {
      return left.id.localeCompare(right.id);
    }
    return leftKey.localeCompare(rightKey);
  });

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const toUploadErrorMessage = (error: unknown, fallback: string): string => {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "auth/operation-not-allowed") {
    return "Firebase Anonymous Auth is disabled. Enable Anonymous sign-in in Firebase Authentication.";
  }
  if (code === "storage/unauthorized" || code === "storage/permission-denied") {
    return "Image upload blocked by storage permissions. Please update Firebase Storage rules.";
  }
  if (code === "storage/unauthenticated") {
    return "You must be signed in to upload files.";
  }
  if (code === "storage/quota-exceeded") {
    return "Storage quota exceeded. Contact admin.";
  }
  return toErrorMessage(error, fallback);
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const uploadTaskChatFileWithRetry = async (
  taskId: string,
  file: File,
  kind: "images" | "files"
): Promise<{ downloadUrl: string; storagePath: string }> => {
  try {
    return await withTimeout(
      uploadTaskChatFile(taskId, file, kind),
      UPLOAD_TIMEOUT_MS,
      `${kind === "images" ? "Image" : "File"} upload timed out. Retrying once...`
    );
  } catch (error) {
    const message = toErrorMessage(error, "");
    if (!/timed out/i.test(message)) {
      throw error;
    }
  }

  return withTimeout(
    uploadTaskChatFile(taskId, file, kind),
    UPLOAD_RETRY_TIMEOUT_MS,
    `${kind === "images" ? "Image" : "File"} upload timed out. Please try again.`
  );
};

const fileNameWithoutExtension = (name: string): string => {
  const trimmed = String(name ?? "").trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return trimmed || "image";
  }
  return trimmed.slice(0, dotIndex);
};

const loadImageElement = async (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for compression."));
    };
    image.src = objectUrl;
  });

const canvasToBlob = async (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to compress image."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });

const compressImageForChat = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) {
    return file;
  }
  if (file.size <= IMAGE_COMPRESSION_TRIGGER_BYTES) {
    return file;
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    return file;
  }

  const image = await loadImageElement(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    return file;
  }

  const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return file;
  }
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const qualities = [0.86, 0.76, 0.66, 0.56, 0.46];
  let bestBlob: Blob | null = null;
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, quality);
    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }
    if (blob.size <= IMAGE_COMPRESSED_TARGET_BYTES) {
      bestBlob = blob;
      break;
    }
  }

  if (!bestBlob || bestBlob.size >= file.size) {
    return file;
  }

  return new File([bestBlob], `${fileNameWithoutExtension(file.name)}-compressed.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
};

export interface UseTaskRealtimeChatOptions {
  token?: string;
  taskId?: string;
  currentUserId?: string;
  enabled?: boolean;
  panelVisible?: boolean;
  onError?: (message: string) => void;
}

export interface UseTaskRealtimeChatResult {
  messages: TaskMessageRecord[];
  activities: TaskConversationActivityRecord[];
  typing: TaskTypingRecord[];
  readReceipts: TaskReadReceiptRecord[];
  draft: string;
  setDraft: (value: string) => void;
  isReady: boolean;
  isSending: boolean;
  deletingMessageId: string | null;
  sendError: string | null;
  sendMessage: () => Promise<void>;
  sendImageMessage: (file: File) => Promise<void>;
  sendFileMessage: (file: File) => Promise<void>;
  createPollMessage: (question: string, options: string[]) => Promise<void>;
  votePollOption: (pollId: string, optionId: string) => Promise<void>;
  deleteMessage: (message: TaskMessageRecord) => Promise<void>;
  clearSendError: () => void;
}

const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export const useTaskRealtimeChat = ({
  token,
  taskId,
  currentUserId,
  enabled = true,
  panelVisible = true,
  onError
}: UseTaskRealtimeChatOptions): UseTaskRealtimeChatResult => {
  const tokenValue = token ?? "";
  const taskIdValue = taskId ?? "";
  const userIdValue = currentUserId ?? "";
  const isReady = enabled && tokenValue.length > 0 && taskIdValue.length > 0 && userIdValue.length > 0;

  const [conversation, setConversation] = useState<TaskConversationSnapshot>(() => emptyConversationSnapshot(taskIdValue));
  const [typing, setTyping] = useState<TaskTypingRecord[]>([]);
  const [readReceipts, setReadReceipts] = useState<TaskReadReceiptRecord[]>([]);
  const [pendingMessages, setPendingMessages] = useState<TaskMessageRecord[]>([]);
  const [draft, setDraftState] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const typingFlagRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = toErrorMessage(error, fallback);
      onError?.(message);
      return message;
    },
    [onError]
  );

  useEffect(() => {
    setConversation(emptyConversationSnapshot(taskIdValue));
    setTyping([]);
    setReadReceipts([]);
    setPendingMessages([]);
    setDraftState("");
    setSendError(null);
    setDeletingMessageId(null);
    typingFlagRef.current = false;
  }, [taskIdValue]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const stopConversation = tasksApi.subscribeTaskConversation(
      tokenValue,
      taskIdValue,
      (snapshot) => {
        setConversation(snapshot);
      },
      (error) => {
        reportError(error, "Failed to subscribe to task conversation.");
      }
    );

    const stopTyping = tasksApi.subscribeTaskTyping(
      tokenValue,
      taskIdValue,
      (rows) => {
        setTyping(rows);
      },
      (error) => {
        reportError(error, "Failed to subscribe to typing status.");
      }
    );

    const stopReadReceipts = tasksApi.subscribeTaskReadReceipts(
      tokenValue,
      taskIdValue,
      (rows) => {
        setReadReceipts(rows);
      },
      (error) => {
        reportError(error, "Failed to subscribe to read receipts.");
      }
    );

    return () => {
      stopConversation();
      stopTyping();
      stopReadReceipts();
    };
  }, [isReady, reportError, taskIdValue, tokenValue]);

  const publishTyping = useCallback(
    (isTyping: boolean) => {
      if (!isReady) {
        return;
      }
      if (typingFlagRef.current === isTyping) {
        return;
      }

      typingFlagRef.current = isTyping;
      void tasksApi.setTaskTyping(tokenValue, taskIdValue, isTyping).catch((error) => {
        reportError(error, "Failed to update typing status.");
      });
    },
    [isReady, reportError, taskIdValue, tokenValue]
  );

  useEffect(() => {
    if (!isReady) {
      typingFlagRef.current = false;
      return;
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    const hasText = draft.trim().length > 0;
    if (!hasText) {
      publishTyping(false);
      return;
    }

    publishTyping(true);
    typingTimeoutRef.current = setTimeout(() => {
      publishTyping(false);
    }, TYPING_IDLE_MS);

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [draft, isReady, publishTyping]);

  useEffect(
    () => () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      publishTyping(false);
    },
    [publishTyping]
  );

  const messages = useMemo(() => {
    const deduped = new Map<string, TaskMessageRecord>();
    [...conversation.messages, ...pendingMessages].forEach((message) => {
      deduped.set(message.id, message);
    });
    return sortMessages([...deduped.values()]);
  }, [conversation.messages, pendingMessages]);

  const visibleTyping = useMemo(() => {
    const now = Date.now();
    return typing.filter((entry) => {
      if (!entry.isTyping || entry.userId === userIdValue) {
        return false;
      }
      const updatedAt = new Date(entry.updatedAt).getTime();
      if (Number.isNaN(updatedAt)) {
        return false;
      }
      return now - updatedAt <= TYPING_STALE_MS;
    });
  }, [typing, userIdValue]);

  useEffect(() => {
    if (!isReady || !panelVisible) {
      return;
    }
    const lastMessageId = messages[messages.length - 1]?.id;
    if (!lastMessageId) {
      return;
    }
    void tasksApi
      .setTaskReadReceipt(tokenValue, taskIdValue, {
        lastReadAt: new Date().toISOString(),
        lastReadMessageId: lastMessageId
      })
      .catch((error) => {
        reportError(error, "Failed to update read receipt.");
      });
  }, [isReady, messages, panelVisible, reportError, taskIdValue, tokenValue]);

  const sendPayload = useCallback(
    async (payload: TaskOutgoingMessagePayload, optimisticMessage: TaskMessageRecord, options?: { clearDraft?: boolean }) => {
      if (!isReady) {
        return;
      }

      setPendingMessages((current) => sortMessages([...current, optimisticMessage]));
      if (options?.clearDraft) {
        setDraftState("");
      }
      setSendError(null);
      setIsSending(true);

      try {
        await tasksApi.sendTaskRichMessage(tokenValue, taskIdValue, payload);
      } catch (error) {
        const message = reportError(error, "Failed to send message.");
        setSendError(message);
      } finally {
        setPendingMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
        setIsSending(false);
      }
    },
    [isReady, reportError, taskIdValue, tokenValue]
  );

  const sendMessage = useCallback(async () => {
    if (!isReady) {
      return;
    }

    const text = draft.trim();
    if (!text) {
      return;
    }

    const createdAt = new Date().toISOString();
    const pendingId = `pending-${Math.random().toString(36).slice(2, 10)}`;
    const optimisticMessage: TaskMessageRecord = {
      id: pendingId,
      taskId: taskIdValue,
      text,
      senderId: userIdValue,
      createdAt,
      clientCreatedAt: createdAt,
      messageType: "text",
      source: "optimistic",
      deliveryState: "pending"
    };

    await sendPayload({ type: "text", text }, optimisticMessage, { clearDraft: true });
  }, [draft, isReady, sendPayload, taskIdValue, userIdValue]);

  const sendImageMessage = useCallback(
    async (file: File) => {
      if (!isReady) {
        return;
      }
      if (!file.type.startsWith("image/")) {
        setSendError("Please select an image file.");
        return;
      }
      if (file.size > MAX_RAW_IMAGE_BYTES) {
        setSendError("Image is too large. Please use an image under 35 MB.");
        return;
      }
      const uploadImage = await compressImageForChat(file).catch(() => file);
      if (uploadImage.size > MAX_CHAT_UPLOAD_BYTES) {
        setSendError("Image is too large after compression. Please use a smaller image.");
        return;
      }
      const caption = draft.trim();
      const createdAt = new Date().toISOString();
      const pendingId = `pending-${Math.random().toString(36).slice(2, 10)}`;
      const previewUrl = URL.createObjectURL(file);
      const optimisticMessage: TaskMessageRecord = {
        id: pendingId,
        taskId: taskIdValue,
        text: caption || "Image",
        senderId: userIdValue,
        createdAt,
        clientCreatedAt: createdAt,
        messageType: "image",
        imageUrl: previewUrl,
        fileName: file.name,
        source: "optimistic",
        deliveryState: "pending"
      };
      setPendingMessages((current) => sortMessages([...current, optimisticMessage]));
      setSendError(null);
      setIsSending(true);
      try {
        const { downloadUrl } = await uploadTaskChatFileWithRetry(taskIdValue, uploadImage, "images");
        await tasksApi.sendTaskRichMessage(tokenValue, taskIdValue, {
          type: "image",
          imageUrl: downloadUrl,
          text: caption,
          fileName: uploadImage.name || file.name
        });
        setDraftState("");
      } catch (error) {
        const message = toUploadErrorMessage(error, "Failed to upload image.");
        onError?.(message);
        setSendError(message);
      } finally {
        setPendingMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
        setIsSending(false);
        URL.revokeObjectURL(previewUrl);
      }
    },
    [draft, isReady, onError, taskIdValue, tokenValue, userIdValue]
  );

  const sendFileMessage = useCallback(
    async (file: File) => {
      if (!isReady) {
        return;
      }
      if (file.size > MAX_CHAT_UPLOAD_BYTES) {
        setSendError("File is too large. Please use a file under 20 MB.");
        return;
      }
      const caption = draft.trim();
      const createdAt = new Date().toISOString();
      const pendingId = `pending-${Math.random().toString(36).slice(2, 10)}`;
      const previewUrl = URL.createObjectURL(file);
      const optimisticMessage: TaskMessageRecord = {
        id: pendingId,
        taskId: taskIdValue,
        text: caption || file.name,
        senderId: userIdValue,
        createdAt,
        clientCreatedAt: createdAt,
        messageType: "file",
        fileUrl: previewUrl,
        fileName: file.name,
        fileMimeType: file.type || undefined,
        fileSizeBytes: file.size,
        source: "optimistic",
        deliveryState: "pending"
      };
      setPendingMessages((current) => sortMessages([...current, optimisticMessage]));
      setSendError(null);
      setIsSending(true);
      try {
        const { downloadUrl } = await uploadTaskChatFileWithRetry(taskIdValue, file, "files");
        await tasksApi.sendTaskRichMessage(tokenValue, taskIdValue, {
          type: "file",
          fileUrl: downloadUrl,
          fileName: file.name,
          text: caption,
          mimeType: file.type || undefined,
          sizeBytes: file.size
        });
        setDraftState("");
      } catch (error) {
        const message = toUploadErrorMessage(error, "Failed to upload file.");
        onError?.(message);
        setSendError(message);
      } finally {
        setPendingMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
        setIsSending(false);
        URL.revokeObjectURL(previewUrl);
      }
    },
    [draft, isReady, onError, taskIdValue, tokenValue, userIdValue]
  );

  const createPollMessage = useCallback(
    async (question: string, options: string[]) => {
      if (!isReady) {
        return;
      }
      const normalizedQuestion = question.trim();
      const normalizedOptions: TaskPollOptionRecord[] = options
        .map((label) => String(label ?? "").trim())
        .filter((label) => Boolean(label))
        .map((label) => ({ id: randomId("poll-option"), label }));
      if (!normalizedQuestion || normalizedOptions.length < 2) {
        setSendError("Poll requires a question and at least 2 options.");
        return;
      }
      const pollId = randomId("poll");
      const createdAt = new Date().toISOString();
      const pendingId = `pending-${Math.random().toString(36).slice(2, 10)}`;
      const optimisticMessage: TaskMessageRecord = {
        id: pendingId,
        taskId: taskIdValue,
        text: normalizedQuestion,
        senderId: userIdValue,
        createdAt,
        clientCreatedAt: createdAt,
        messageType: "poll",
        poll: {
          pollId,
          question: normalizedQuestion,
          options: normalizedOptions
        },
        source: "optimistic",
        deliveryState: "pending"
      };
      await sendPayload(
        {
          type: "poll",
          question: normalizedQuestion,
          options: normalizedOptions,
          pollId
        },
        optimisticMessage
      );
    },
    [isReady, sendPayload, taskIdValue, userIdValue]
  );

  const votePollOption = useCallback(
    async (pollId: string, optionId: string) => {
      if (!isReady) {
        return;
      }
      const normalizedPollId = String(pollId ?? "").trim();
      const normalizedOptionId = String(optionId ?? "").trim();
      if (!normalizedPollId || !normalizedOptionId) {
        return;
      }
      const createdAt = new Date().toISOString();
      const pendingId = `pending-${Math.random().toString(36).slice(2, 10)}`;
      const optimisticMessage: TaskMessageRecord = {
        id: pendingId,
        taskId: taskIdValue,
        text: "Voted on poll",
        senderId: userIdValue,
        createdAt,
        clientCreatedAt: createdAt,
        messageType: "poll-vote",
        pollVote: {
          pollId: normalizedPollId,
          optionId: normalizedOptionId
        },
        source: "optimistic",
        deliveryState: "pending"
      };
      await sendPayload(
        {
          type: "poll-vote",
          pollId: normalizedPollId,
          optionId: normalizedOptionId
        },
        optimisticMessage
      );
    },
    [isReady, sendPayload, taskIdValue, userIdValue]
  );

  const deleteMessage = useCallback(
    async (message: TaskMessageRecord) => {
      if (!isReady) {
        return;
      }

      if (message.deliveryState === "pending" || message.source === "optimistic") {
        setPendingMessages((current) => current.filter((item) => item.id !== message.id));
        return;
      }

      setSendError(null);
      setDeletingMessageId(message.id);
      try {
        await tasksApi.deleteTaskMessage(tokenValue, taskIdValue, message.id, message.source);
      } catch (error) {
        const text = reportError(error, "Failed to delete message.");
        setSendError(text);
      } finally {
        setDeletingMessageId((current) => (current === message.id ? null : current));
      }
    },
    [isReady, reportError, taskIdValue, tokenValue]
  );

  const setDraft = useCallback((value: string) => {
    setDraftState(value);
  }, []);

  const clearSendError = useCallback(() => {
    setSendError(null);
  }, []);

  return {
    messages,
    activities: conversation.activities,
    typing: visibleTyping,
    readReceipts,
    draft,
    setDraft,
    isReady,
    isSending,
    deletingMessageId,
    sendError,
    sendMessage,
    sendImageMessage,
    sendFileMessage,
    createPollMessage,
    votePollOption,
    deleteMessage,
    clearSendError
  };
};
