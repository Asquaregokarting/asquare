import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { fmtDateTimeFullIST } from "../../../lib/date-format";
import { TaskMessageRecord, TaskReadReceiptRecord, TaskTypingRecord } from "../../api/types";

interface TaskChatPanelProps {
  messages: TaskMessageRecord[];
  typing: TaskTypingRecord[];
  readReceipts: TaskReadReceiptRecord[];
  currentUserId?: string;
  resolveUserName: (userId: string) => string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onSendImage?: (file: File) => void | Promise<void>;
  onSendFile?: (file: File) => void | Promise<void>;
  onCreatePoll?: (question: string, options: string[]) => void | Promise<void>;
  onVotePoll?: (pollId: string, optionId: string) => void | Promise<void>;
  onDeleteMessage?: (message: TaskMessageRecord) => void | Promise<void>;
  isSending?: boolean;
  deletingMessageId?: string | null;
  sendError?: string | null;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

const LONG_PRESS_MS = 450;

const formatDateTime = (value: string): string => {
  return fmtDateTimeFullIST(value);
};

export const TaskChatPanel = ({
  messages,
  typing,
  readReceipts,
  currentUserId,
  resolveUserName,
  draft,
  onDraftChange,
  onSend,
  onSendImage,
  onSendFile,
  onCreatePoll,
  onVotePoll,
  onDeleteMessage,
  isSending = false,
  deletingMessageId = null,
  sendError = null,
  placeholder = "Write a message...",
  emptyMessage = "No messages yet.",
  disabled = false
}: TaskChatPanelProps) => {
  const [activeMenuMessageId, setActiveMenuMessageId] = useState<string | null>(null);
  const [pollBuilderOpen, setPollBuilderOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollDraftError, setPollDraftError] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const typingText = useMemo(() => {
    const names = typing.map((entry) => resolveUserName(entry.userId)).slice(0, 2);
    if (names.length === 0) {
      return "";
    }
    if (names.length === 1) {
      return `${names[0]} is typing...`;
    }
    return `${names[0]}, ${names[1]} are typing...`;
  }, [resolveUserName, typing]);

  const readReceiptLabel = useMemo(() => {
    const latest = [...readReceipts]
      .filter((entry) => entry.userId !== currentUserId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!latest) {
      return "";
    }
    return `Seen by ${resolveUserName(latest.userId)} at ${formatDateTime(latest.lastReadAt)}`;
  }, [currentUserId, readReceipts, resolveUserName]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [messages.length]);

  const visibleMessages = useMemo(() => messages.filter((message) => message.messageType !== "poll-vote"), [messages]);

  const pollVotesByPollId = useMemo(() => {
    const latestVoteByUserByPoll = new Map<string, Map<string, string>>();
    messages.forEach((message) => {
      if (message.messageType !== "poll-vote" || !message.pollVote) {
        return;
      }
      const pollId = message.pollVote.pollId;
      const optionId = message.pollVote.optionId;
      if (!pollId || !optionId) {
        return;
      }
      if (!latestVoteByUserByPoll.has(pollId)) {
        latestVoteByUserByPoll.set(pollId, new Map());
      }
      latestVoteByUserByPoll.get(pollId)?.set(message.senderId, optionId);
    });

    const summary = new Map<string, { totalVotes: number; counts: Record<string, number>; myVoteOptionId?: string }>();
    latestVoteByUserByPoll.forEach((votesByUser, pollId) => {
      const counts: Record<string, number> = {};
      let myVoteOptionId: string | undefined;
      votesByUser.forEach((optionId, userId) => {
        counts[optionId] = (counts[optionId] ?? 0) + 1;
        if (userId === currentUserId) {
          myVoteOptionId = optionId;
        }
      });
      summary.set(pollId, {
        totalVotes: Object.values(counts).reduce((sum, value) => sum + value, 0),
        counts,
        myVoteOptionId
      });
    });
    return summary;
  }, [currentUserId, messages]);

  useEffect(
    () => () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    },
    []
  );

  const startLongPress = (messageId: string) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTimerRef.current = setTimeout(() => {
      setActiveMenuMessageId(messageId);
    }, LONG_PRESS_MS);
  };

  const stopLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const triggerImagePicker = () => {
    imageInputRef.current?.click();
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const resetPollBuilder = () => {
    setPollQuestion("");
    setPollOptions(["", ""]);
    setPollDraftError(null);
  };

  const handleOpenPollBuilder = () => {
    if (!onCreatePoll || disabled || isSending) {
      return;
    }
    setPollBuilderOpen(true);
    setPollDraftError(null);
  };

  const handleAddPollChoice = () => {
    if (pollOptions.length >= 8) {
      return;
    }
    setPollOptions((current) => [...current, ""]);
  };

  const handleRemovePollChoice = (index: number) => {
    if (pollOptions.length <= 2) {
      return;
    }
    setPollOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
  };

  const handleCreatePoll = () => {
    if (!onCreatePoll || disabled || isSending) {
      return;
    }

    const normalizedQuestion = pollQuestion.trim();
    const normalizedOptions = pollOptions.map((option) => option.trim()).filter((option) => option.length > 0);
    if (!normalizedQuestion) {
      setPollDraftError("Poll question is required.");
      return;
    }
    if (normalizedOptions.length < 2) {
      setPollDraftError("Add at least two options.");
      return;
    }

    setPollDraftError(null);
    void Promise.resolve(onCreatePoll(normalizedQuestion, normalizedOptions)).then(() => {
      setPollBuilderOpen(false);
      resetPollBuilder();
    });
  };

  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-surface/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h5 className="text-base font-semibold text-text">Task Chat</h5>
        <span className="text-xs text-muted">{visibleMessages.length} messages</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {visibleMessages.length > 0 ? (
          visibleMessages.map((message) => {
            const isCurrentUser = message.senderId === currentUserId;
            const canDeleteMessage =
              Boolean(onDeleteMessage) &&
              Boolean(currentUserId) &&
              isCurrentUser &&
              message.deliveryState !== "pending" &&
              message.source !== "optimistic";
            return (
              <div key={message.id} className={`relative flex ${isCurrentUser ? "justify-end" : "justify-start"}`}>
                <div
                  onMouseDown={() => startLongPress(message.id)}
                  onMouseUp={stopLongPress}
                  onMouseLeave={stopLongPress}
                  onTouchStart={() => startLongPress(message.id)}
                  onTouchEnd={stopLongPress}
                  onTouchCancel={stopLongPress}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setActiveMenuMessageId(message.id);
                  }}
                  className={`max-w-[86%] rounded-2xl border px-3.5 py-2.5 text-sm shadow-sm ${
                    isCurrentUser
                      ? "rounded-br-md border-info/35 bg-info/10 text-text"
                      : "rounded-bl-md border-border/70 bg-panel text-text"
                  }`}
                >
                  <p className="text-[11px] font-semibold text-muted">{isCurrentUser ? "You" : resolveUserName(message.senderId)}</p>
                  {message.messageType === "image" && message.imageUrl ? (
                    <div className="mt-1 space-y-2">
                      <img src={message.imageUrl} alt={message.fileName ?? "Image"} className="max-h-56 w-full rounded-lg border border-border/70 object-cover" />
                      {message.text && message.text !== "Image" ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
                    </div>
                  ) : null}
                  {message.messageType === "file" && message.fileUrl ? (
                    <div className="mt-1 space-y-2">
                      {message.text && message.text !== message.fileName ? <p className="whitespace-pre-wrap break-words">{message.text}</p> : null}
                      <div className="rounded-lg border border-border/70 bg-surface/70 px-2 py-1">
                        <p className="text-xs font-semibold text-text">{message.fileName ?? "File"}</p>
                        <a
                          href={message.fileUrl}
                          download={message.fileName ?? "file"}
                          target="_blank"
                          rel="noreferrer"
                          className="ui-btn ui-btn-info mt-1 min-h-8 px-2.5 py-1 text-[11px]"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  ) : null}
                  {message.messageType === "poll" && message.poll ? (
                    <div className="mt-2 overflow-hidden rounded-xl border border-info/30 bg-surface/80 shadow-sm">
                      <div className="flex items-center justify-between border-b border-info/20 bg-info/8 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-info">Poll</p>
                        <span className="rounded-full border border-info/35 bg-surface/80 px-2 py-0.5 text-[10px] font-semibold text-info">Live</span>
                      </div>
                      <div className="space-y-2 px-3 py-3">
                        <p className="text-sm font-semibold leading-snug text-text">{message.poll.question}</p>
                        {message.poll.options.map((option) => {
                          const pollState = pollVotesByPollId.get(message.poll?.pollId ?? "");
                          const voteCount = pollState?.counts[option.id] ?? 0;
                          const selected = pollState?.myVoteOptionId === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                if (!onVotePoll || !message.poll) {
                                  return;
                                }
                                void onVotePoll(message.poll.pollId, option.id);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs ${
                                selected
                                  ? "border-info/55 bg-info/15 text-info"
                                  : "border-border/70 bg-surface/60 text-text hover:border-info/35"
                              }`}
                              disabled={!onVotePoll || disabled}
                            >
                              <span>{option.label}</span>
                              <span className="font-semibold">{voteCount}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-border/60 bg-panel/70 px-3 py-2 text-[11px] text-muted">
                        Total votes: {pollVotesByPollId.get(message.poll.pollId)?.totalVotes ?? 0}
                      </div>
                    </div>
                  ) : null}
                  {(!message.messageType || message.messageType === "text") && <p className="mt-1 whitespace-pre-wrap break-words">{message.text}</p>}
                  <p className="mt-1 text-[11px] text-muted">
                    {formatDateTime(message.createdAt)}
                    {message.deliveryState === "pending" ? " | Sending..." : ""}
                  </p>
                  {isCurrentUser && readReceiptLabel ? <p className="mt-1 text-[11px] text-muted">{readReceiptLabel}</p> : null}
                </div>

                {activeMenuMessageId === message.id ? (
                  <div
                    className={`absolute top-full z-20 mt-1.5 min-w-40 rounded-lg border border-border/75 bg-panel p-1 shadow-panel ${
                      isCurrentUser ? "right-0" : "left-0"
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-critical transition hover:bg-critical/10 disabled:cursor-not-allowed disabled:text-muted"
                      onClick={() => {
                        if (!canDeleteMessage || !onDeleteMessage) {
                          return;
                        }
                        setActiveMenuMessageId(null);
                        void onDeleteMessage(message);
                      }}
                      disabled={!canDeleteMessage || deletingMessageId === message.id}
                    >
                      {deletingMessageId === message.id ? "Deleting..." : "Delete message"}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted">{emptyMessage}</p>
        )}
        <div ref={chatEndRef} />
      </div>

      {activeMenuMessageId ? (
        <button
          type="button"
          className="fixed inset-0 z-10 cursor-default bg-transparent"
          onClick={() => setActiveMenuMessageId(null)}
          aria-label="Close message menu"
        />
      ) : null}

      {typingText ? <p className="mt-3 text-xs text-muted">{typingText}</p> : null}
      {sendError ? <p className="mt-2 text-xs text-critical">{sendError}</p> : null}

      {pollBuilderOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-base/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/75 bg-panel shadow-panel">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div>
                <h6 className="text-lg font-semibold text-text">Create Poll</h6>
                <p className="text-xs text-muted">Ask a question and add answer choices</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPollBuilderOpen(false);
                  resetPollBuilder();
                }}
                className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-xs"
                disabled={isSending}
              >
                Close
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                Question
                <input
                  type="text"
                  value={pollQuestion}
                  onChange={(event) => setPollQuestion(event.target.value)}
                  className="ui-field rounded-lg border-border/75 bg-surface font-normal"
                  placeholder="Ask your poll question..."
                  disabled={isSending}
                />
              </label>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Options</p>
                {pollOptions.map((option, index) => (
                  <div key={`poll-option-${index}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={option}
                      onChange={(event) =>
                        setPollOptions((current) => current.map((item, optionIndex) => (optionIndex === index ? event.target.value : item)))
                      }
                      className="ui-field flex-1 rounded-lg border-border/75 bg-surface"
                      placeholder={`Choice ${index + 1}`}
                      disabled={isSending}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePollChoice(index)}
                      className="ui-btn ui-btn-neutral min-h-8 px-2.5 py-1 text-[11px] hover:border-critical/45 hover:text-critical disabled:opacity-50"
                      disabled={pollOptions.length <= 2 || isSending}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddPollChoice}
                  className="ui-btn ui-btn-info min-h-8 px-2.5 py-1 text-xs disabled:opacity-50"
                  disabled={pollOptions.length >= 8 || isSending}
                >
                  + Add Choice
                </button>
              </div>

              {pollDraftError ? <p className="text-xs text-critical">{pollDraftError}</p> : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setPollBuilderOpen(false);
                  resetPollBuilder();
                }}
                className="ui-btn ui-btn-neutral"
                disabled={isSending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreatePoll}
                className="ui-btn ui-btn-info disabled:opacity-60"
                disabled={isSending || disabled}
              >
                {isSending ? "Creating Poll..." : "Create Poll"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={triggerImagePicker}
          className="ui-btn ui-btn-neutral min-h-9 px-2.5 py-1 text-xs hover:border-info/35"
          disabled={disabled || isSending || !onSendImage}
        >
          Image
        </button>
        <button
          type="button"
          onClick={triggerFilePicker}
          className="ui-btn ui-btn-neutral min-h-9 px-2.5 py-1 text-xs hover:border-info/35"
          disabled={disabled || isSending || !onSendFile}
        >
          File
        </button>
        <button
          type="button"
          onClick={handleOpenPollBuilder}
          className="ui-btn ui-btn-neutral min-h-9 px-2.5 py-1 text-xs hover:border-info/35"
          disabled={disabled || isSending || !onCreatePoll}
        >
          Poll
        </button>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && onSendImage) {
            void onSendImage(file);
          }
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && onSendFile) {
            void onSendFile(file);
          }
          event.currentTarget.value = "";
        }}
      />

      <form onSubmit={onSend} className="mt-4 flex items-stretch gap-2">
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="ui-field flex-1"
          placeholder={placeholder}
          disabled={disabled || isSending}
        />
        <button
          type="submit"
          className="ui-btn ui-btn-info min-w-[88px] disabled:opacity-60"
          disabled={disabled || isSending || !draft.trim()}
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
};
