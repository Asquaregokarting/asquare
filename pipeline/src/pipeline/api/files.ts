import { apiRequest } from "./client";
import { FileRecord } from "./types";
import { createFirestoreFileRecord, listFirestoreFiles, revokeFirestoreFileRecord } from "./files-firestore";
import { resolveHostedUrl } from "../app/runtime";

const GOOGLE_DRIVE_PROXY_URL =
  (import.meta.env.VITE_GOOGLE_DRIVE_PROXY_URL as string | undefined)?.trim() ||
  `${import.meta.env.BASE_URL ?? "/"}google-drive-proxy.php`;

export const filesApi = {
  list(_token: string, query?: { workspaceId?: string; taskId?: string }): Promise<{ files: FileRecord[] }> {
    return listFirestoreFiles(query).then((files) => ({ files }));
  },
  async uploadToDrive(
    token: string,
    payload: {
      taskId: string;
      workspaceId: string;
      file: File;
      folderPath?: string;
      notes?: string;
    }
  ): Promise<{ attachment: FileRecord }> {
    const formData = new FormData();
    formData.set("file", payload.file);
    formData.set("taskId", payload.taskId);
    formData.set("workspaceId", payload.workspaceId);
    if (payload.folderPath?.trim()) {
      formData.set("folderPath", payload.folderPath.trim());
    }
    if (payload.notes?.trim()) {
      formData.set("notes", payload.notes.trim());
    }

    const response = await fetch(resolveHostedUrl(GOOGLE_DRIVE_PROXY_URL), {
      method: "POST",
      headers: {
        "X-Pipeline-Token": token
      },
      body: formData
    });
    const result = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: unknown;
          file?: {
            id?: unknown;
            webViewLink?: unknown;
            webContentLink?: unknown;
            name?: unknown;
          };
        }
      | null;

    if (!response.ok || !result?.ok || !result.file) {
      throw new Error(String(result?.error ?? `Drive upload failed (${response.status}).`));
    }

    const downloadPath = String(result.file.webViewLink ?? result.file.webContentLink ?? "").trim();
    if (!downloadPath) {
      throw new Error("Drive upload succeeded, but no viewer link was returned.");
    }

    const attachment = await createFirestoreFileRecord(token, {
      taskId: payload.taskId,
      workspaceId: payload.workspaceId,
      fileName: String(result.file.name ?? payload.file.name),
      mimeType: payload.file.type || "application/octet-stream",
      sizeBytes: payload.file.size,
      downloadPath,
      driveFileId: String(result.file.id ?? ""),
      folderPath: payload.folderPath,
      notes: payload.notes
    });

    return { attachment };
  },
  createUploadSession(
    token: string,
    payload: { taskId: string; fileName: string; mimeType: string; sizeBytes: number }
  ): Promise<{
    uploadSession: {
      id: string;
      taskId: string;
      uploadUrl: string;
      expiresAt: string;
    };
  }> {
    return apiRequest(
      "/files/upload-session",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  completeUpload(token: string, payload: { uploadSessionId: string; storageFileId?: string }): Promise<{ attachment: FileRecord }> {
    return apiRequest(
      "/files/complete",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { token }
    );
  },
  revoke(_token: string, fileId: string): Promise<{ attachment: FileRecord }> {
    return revokeFirestoreFileRecord(fileId).then((attachment) => ({ attachment }));
  }
};
