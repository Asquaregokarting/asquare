import { FormEvent, useEffect, useState } from "react";
import { fmtDateTimeFullIST } from "../../../lib/date-format";
import { filesApi } from "../../api/files";
import { tasksApi } from "../../api/tasks";
import { FileRecord, TaskRecord, WorkspaceRecord } from "../../api/types";
import { ModulePageLayout } from "../../components/layout/ModulePageLayout";
import { DataTable } from "../../components/ui/DataTable";
import { DetailPanel } from "../../components/ui/DetailPanel";
import { FilterBar, FilterField } from "../../components/ui/FilterBar";
import { SummaryCards } from "../../components/ui/SummaryCards";
import { useAuth } from "../../features/auth/auth-context";

export type FilesView = "library" | "uploads";

const subnav = [
  { label: "Library", to: "/files/library" },
  { label: "Uploads", to: "/files/uploads" }
];

const formatSize = (sizeBytes: number): string => {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
};

const FilesModule = ({ view }: { view: FilesView }) => {
  const { session } = useAuth();
  const token = session?.token;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [folderPath, setFolderPath] = useState("General");
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [filesResult, taskResult, workspaceResult] = await Promise.all([
        filesApi.list(token, { workspaceId: workspaceId || undefined, taskId: taskId || undefined }),
        tasksApi.listTasks(token),
        tasksApi.listWorkspaces(token)
      ]);
      setFiles(filesResult.files);
      setTasks(taskResult.tasks);
      setWorkspaces(workspaceResult.workspaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load file data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspaceId, taskId, view]);

  const run = async (action: () => Promise<unknown>, successMessage: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "File action failed.");
    } finally {
      setLoading(false);
    }
  };

  if (!session || !token) {
    return null;
  }

  const filteredTasks = workspaceId ? tasks.filter((task) => task.workspaceId === workspaceId) : tasks;
  const selectedTask = tasks.find((task) => task.id === taskId) ?? null;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const activeFiles = files.filter((file) => !file.revokedAt);
  const revokedFiles = files.filter((file) => Boolean(file.revokedAt));

  return (
    <ModulePageLayout
      moduleTab="Files"
      title={view === "library" ? "Drive File Library" : "Drive Upload Center"}
      subtitle={
        view === "library"
          ? "Browse view-only Google Drive files linked to Pipeline tasks and workspaces."
          : "Upload directly into the shared Drive library, then mirror metadata into Firestore."
      }
      breadcrumbs={["Pipeline", "Files", view === "library" ? "Library" : "Uploads"]}
      subnav={subnav}
    >
      {error ? <p className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">{error}</p> : null}
      {success ? <p className="mb-3 rounded-lg border border-success/45 bg-success/10 px-3 py-2 text-sm text-success">{success}</p> : null}

      <FilterBar>
        <FilterField label="Workspace">
          <select
            className="ui-field min-h-10"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            <option value="">All</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.workspaceName}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Task">
          <select
            className="ui-field min-h-10"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
          >
            <option value="">All</option>
            {filteredTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.taskName}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      <SummaryCards
        items={[
          { id: "files-total", label: "Visible Files", value: String(activeFiles.length), tone: "info" },
          { id: "files-revoked", label: "Revoked", value: String(revokedFiles.length), tone: "warning" },
          {
            id: "files-workspace",
            label: "Workspace Scope",
            value: selectedWorkspace?.workspaceName ?? (workspaceId ? workspaceId : "All"),
            tone: "muted"
          },
          {
            id: "files-task",
            label: "Task Scope",
            value: selectedTask?.taskName ?? (taskId ? taskId : "All"),
            tone: "success"
          }
        ]}
      />

      {view === "uploads" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr,0.9fr]">
          <DetailPanel title="Upload To Shared Drive">
            <form
              className="grid grid-cols-1 gap-3"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void run(
                  async () => {
                    if (!selectedFile) {
                      throw new Error("Select a file to upload.");
                    }
                    const effectiveTaskId = taskId || selectedTask?.id || "";
                    const effectiveWorkspaceId = workspaceId || selectedTask?.workspaceId || "";
                    if (!effectiveTaskId || !effectiveWorkspaceId) {
                      throw new Error("Choose both workspace and task before uploading.");
                    }
                    await filesApi.uploadToDrive(token, {
                      taskId: effectiveTaskId,
                      workspaceId: effectiveWorkspaceId,
                      file: selectedFile,
                      folderPath: folderPath.trim() || undefined,
                      notes: notes.trim() || undefined
                    });
                    setSelectedFile(null);
                    setNotes("");
                  },
                  "File uploaded to Google Drive and linked in Firestore."
                );
              }}
            >
              <select
                className="ui-field min-h-10"
                value={workspaceId}
                onChange={(event) => {
                  setWorkspaceId(event.target.value);
                  setTaskId("");
                }}
                required
              >
                <option value="">Select workspace</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.workspaceName}
                  </option>
                ))}
              </select>

              <select className="ui-field min-h-10" value={taskId} onChange={(event) => setTaskId(event.target.value)} required>
                <option value="">Select task</option>
                {filteredTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.taskName}
                  </option>
                ))}
              </select>

              <input
                className="ui-field min-h-10"
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="Drive folder path, for example Operations/Bookings"
              />
              <textarea
                className="ui-field min-h-24"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="File notes or context"
              />
              <label className="grid gap-2 rounded-xl border border-dashed border-border bg-panel/40 px-4 py-4 text-sm text-muted">
                <span className="font-semibold text-text">Choose file</span>
                <input
                  type="file"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-text file:mr-2 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-xs file:font-semibold file:text-text"
                  required
                />
                <span>{selectedFile ? `${selectedFile.name} • ${formatSize(selectedFile.size)}` : "Any uploaded file is published as a Drive viewer link."}</span>
              </label>

              <button type="submit" className="ui-btn ui-btn-primary min-h-10">
                Upload To Drive
              </button>
            </form>
          </DetailPanel>

          <DetailPanel title="Upload Rules">
            <ul className="space-y-2 text-sm text-muted">
              <li>Uploaded files are stored in Google Drive and mirrored into the Firestore `files` collection.</li>
              <li>Every uploaded file is published as `view only` so anyone with the link can open it safely.</li>
              <li>Choose a workspace and task so the file stays searchable and linked to operational work.</li>
              <li>Revoking access hides the file in Pipeline and marks the task attachment as revoked.</li>
            </ul>
          </DetailPanel>
        </div>
      ) : null}

      <div className={view === "uploads" ? "mt-4" : ""}>
        <DataTable
          columns={[
            { key: "file", header: "File", render: (file) => file.fileName },
            { key: "task", header: "Task", render: (file) => tasks.find((task) => task.id === file.taskId)?.taskName ?? file.taskId },
            {
              key: "workspace",
              header: "Workspace",
              render: (file) => workspaces.find((workspace) => workspace.id === file.workspaceId)?.workspaceName ?? file.workspaceId
            },
            { key: "folder", header: "Folder", render: (file) => file.folderPath || "-" },
            { key: "uploader", header: "Uploaded By", render: (file) => file.uploaderName ?? "-" },
            { key: "size", header: "Size", render: (file) => formatSize(file.sizeBytes) },
            { key: "uploaded", header: "Uploaded", render: (file) => fmtDateTimeFullIST(file.uploadedAt) },
            {
              key: "status",
              header: "Status",
              render: (file) =>
                file.revokedAt ? (
                  <span className="rounded-full border border-warning/35 bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">Revoked</span>
                ) : (
                  <span className="rounded-full border border-success/35 bg-success/10 px-2 py-1 text-xs font-semibold text-success">Viewer Link</span>
                )
            },
            {
              key: "actions",
              header: "Actions",
              render: (file) => (
                <>
                  <a
                    href={file.downloadPath}
                    target="_blank"
                    rel="noreferrer"
                    className="ui-btn ui-btn-neutral min-h-8 px-2 py-1 text-xs"
                  >
                    Open
                  </a>
                  {!file.revokedAt ? (
                    <button
                      type="button"
                      onClick={() => void run(() => filesApi.revoke(token, file.id), "File access revoked.")}
                      className="ui-btn ui-btn-danger min-h-8 px-2 py-1 text-xs"
                    >
                      Revoke
                    </button>
                  ) : null}
                </>
              )
            }
          ]}
          rows={files}
          rowKey={(file) => file.id}
          emptyMessage={loading ? "Loading files..." : "No files found for selected filters."}
        />
      </div>
    </ModulePageLayout>
  );
};

export default FilesModule;
