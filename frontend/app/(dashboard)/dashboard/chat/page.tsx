"use client";
// Chat page: conversation UI against multi-meeting RAG.

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiClient } from "@/lib/api-client";
import { useRequireAuth } from "@/lib/use-require-auth";
import { usePageTitle } from "@/lib/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  X,
  MessageSquare,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type ChatSource = {
  meeting_id: string;
  meeting_title: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
};

type ChatSession = {
  id: string;
  title: string;
  updated_at: string;
};

type ChatMeeting = {
  id: string;
  title: string;
  created_at: string;
  summary_text: string | null;
};

type ApiError = {
  response?: {
    status?: number;
    data?: { detail?: string; retry_after_seconds?: number };
  };
};

/* -------------------------------------------------------------------------- */
/* Animated colours (pure CSS, no extra dependencies)                         */
/* -------------------------------------------------------------------------- */

const CHAT_CSS = `
@keyframes rm-gradient-shift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes rm-msg-in {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes rm-dot {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-4px); opacity: 1; }
}
@keyframes rm-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes rm-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.0); }
  50%      { box-shadow: 0 0 18px 2px rgba(245, 158, 11, 0.35); }
}
.rm-gradient {
  background-image: linear-gradient(120deg, #10b981, #f59e0b, #84cc16, #10b981);
  background-size: 300% 300%;
  animation: rm-gradient-shift 10s ease infinite;
  color: #fff;
}
.rm-gradient-text {
  background-image: linear-gradient(120deg, #10b981, #f59e0b, #84cc16, #10b981);
  background-size: 300% 300%;
  animation: rm-gradient-shift 10s ease infinite;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.rm-msg { animation: rm-msg-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
.rm-fade { animation: rm-fade-in 0.3s ease both; }
.rm-ai-bubble {
  border-left: 3px solid transparent;
  border-image: linear-gradient(180deg, #10b981, #84cc16) 1;
}
.rm-dot { animation: rm-dot 1.2s ease-in-out infinite; }
.rm-send:not(:disabled) { animation: rm-gradient-shift 10s ease infinite, rm-glow 3s ease-in-out infinite; }
.rm-send { transition: transform 0.15s ease; }
.rm-send:not(:disabled):hover { transform: translateY(-1px); }
.rm-send:not(:disabled):active { transform: scale(0.97); }
.rm-composer:focus-within {
  border-color: transparent;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45);
}
.rm-composer { transition: box-shadow 0.2s ease, border-color 0.2s ease; }
@media (prefers-reduced-motion: reduce) {
  .rm-gradient, .rm-gradient-text, .rm-msg, .rm-fade, .rm-dot, .rm-send {
    animation: none !important;
  }
}
`;

/* -------------------------------------------------------------------------- */
/* Markdown (components object hoisted so it is created once)                 */
/* -------------------------------------------------------------------------- */

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 mb-2 flex flex-col gap-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 mb-2 flex flex-col gap-1">{children}</ol>
  ),
  h1: ({ children }) => (
    <h1 className="text-base font-semibold mb-2 mt-3">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold mb-2 mt-3">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="border-collapse text-xs w-full">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border px-2 py-1 bg-muted text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
  code: ({ children }) => (
    <code className="bg-background/60 px-1 py-0.5 rounded text-xs">{children}</code>
  ),
};

const REMARK_PLUGINS = [remarkGfm];

const MarkdownContent = memo(function MarkdownContent({
  content,
}: {
  content: string;
}) {
  return (
    <div className="text-sm leading-relaxed break-words min-w-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {content}
      </Markdown>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Message list                                                               */
/* -------------------------------------------------------------------------- */

const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: ChatMessage;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("rm-msg", isUser ? "text-right" : "text-left")}>
      {isUser ? (
        <div className="rm-gradient inline-block rounded-2xl rounded-br-sm px-3 py-2 max-w-[70%] text-sm whitespace-pre-wrap break-words cursor-text shadow-sm">
          {message.content}
        </div>
      ) : (
        <div className="rm-ai-bubble inline-block rounded-2xl rounded-bl-sm px-3 py-2 max-w-[80%] bg-muted text-left break-words cursor-text">
          <MarkdownContent content={message.content} />
        </div>
      )}
      {message.sources && message.sources.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {message.sources.map((s) => (
            <span key={s.meeting_id}>📎 {s.meeting_title}</span>
          ))}
        </div>
      )}
    </div>
  );
});

function StatusBubble({ label }: { label: string }) {
  return (
    <div className="rm-fade text-left">
      <div className="inline-flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
        <span>{label}</span>
        <span className="inline-flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="rm-dot h-1.5 w-1.5 rounded-full bg-amber-500"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function MessageList({
  messages,
  sending,
  loadingMessages,
  bottomRef,
}: {
  messages: ChatMessage[];
  sending: boolean;
  loadingMessages: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-1">
        {messages.length === 0 && !loadingMessages && (
          <p className="rm-fade text-sm text-muted-foreground">
            Ask a question about your meetings to get started.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {sending && <StatusBubble label="Thinking" />}
        {loadingMessages && <StatusBubble label="Loading conversation" />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

/* -------------------------------------------------------------------------- */
/* Meeting picker                                                             */
/* -------------------------------------------------------------------------- */

function MeetingCatalog({
  meetings,
  selectedMeetingIds,
  onToggleMeeting,
  onClearAll,
}: {
  meetings: ChatMeeting[];
  selectedMeetingIds: string[];
  onToggleMeeting: (id: string) => void;
  onClearAll: () => void;
}) {
  if (meetings.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No completed meetings yet. Upload a recording to get started.
      </div>
    );
  }
  return (
    <div className="rm-fade flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Available meetings</h3>
        {selectedMeetingIds.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="text-xs h-6 px-2"
          >
            <X className="w-3 h-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>
      <ScrollArea className="max-h-[200px] flex flex-col gap-1">
        {meetings.map((meeting) => {
          const isSelected = selectedMeetingIds.includes(meeting.id);
          return (
            <Button
              key={meeting.id}
              variant={isSelected ? "default" : "outline"}
              className={cn(
                "w-full justify-start text-left h-auto py-2 px-3 gap-2 transition-colors",
                isSelected && "rm-gradient border-0"
              )}
              onClick={() => onToggleMeeting(meeting.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{meeting.title}</p>
                <p
                  className={cn(
                    "text-xs truncate",
                    isSelected ? "text-white/80" : "text-muted-foreground"
                  )}
                >
                  {new Date(meeting.created_at).toLocaleDateString()}
                </p>
                {meeting.summary_text && (
                  <p
                    className={cn(
                      "text-xs line-clamp-2 mt-1",
                      isSelected ? "text-white/80" : "text-muted-foreground"
                    )}
                  >
                    {meeting.summary_text}
                  </p>
                )}
              </div>
              {isSelected && <MessageSquare className="w-4 h-4" />}
            </Button>
          );
        })}
      </ScrollArea>
    </div>
  );
}

function SelectedMeetingsBar({
  meetings,
  selectedMeetingIds,
  onRemoveMeeting,
}: {
  meetings: ChatMeeting[];
  selectedMeetingIds: string[];
  onRemoveMeeting: (id: string) => void;
}) {
  const selected = useMemo(
    () => meetings.filter((m) => selectedMeetingIds.includes(m.id)),
    [meetings, selectedMeetingIds]
  );
  if (selected.length === 0) return null;
  return (
    <div className="rm-fade flex flex-wrap items-center gap-2 mb-4 p-3 bg-muted/50 rounded-lg">
      <span className="text-xs text-muted-foreground mr-2">Context:</span>
      {selected.map((meeting) => (
        <Badge key={meeting.id} variant="secondary" className="rm-msg gap-1">
          {meeting.title}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0"
            onClick={() => onRemoveMeeting(meeting.id)}
            aria-label={`Remove ${meeting.title}`}
          >
            <X className="w-3 h-3" />
          </Button>
        </Badge>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];
const DAY_MS = 86_400_000;

function relativeDayLabel(date: Date, now: Date) {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 days";
  return "Older";
}

function groupSessions(sessions: ChatSession[]) {
  const now = new Date();
  const map = new Map<string, ChatSession[]>();
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  for (const s of sorted) {
    const label = relativeDayLabel(new Date(s.updated_at), now);
    const arr = map.get(label) ?? [];
    arr.push(s);
    map.set(label, arr);
  }
  return GROUP_ORDER.filter((label) => map.has(label)).map((label) => ({
    label,
    items: map.get(label)!,
  }));
}

const SessionButton = memo(function SessionButton({
  session,
  active,
  onSelect,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={cn(
        "w-full rounded-lg px-2 py-2 text-left text-sm transition-all select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-gradient-to-r from-emerald-500/15 via-amber-500/10 to-rose-500/10 text-foreground border-l-2 border-amber-500"
          : "border-l-2 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <span className="block font-medium truncate">
        {session.title || "Untitled chat"}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {new Date(session.updated_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    </button>
  );
});

function ChatSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  collapsed,
  onToggleCollapsed,
  loading,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  loading: boolean;
}) {
  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-border bg-card py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          className="mb-2"
          aria-label="Expand chat history"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNewChat}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <h2 className="rm-gradient-text px-1 text-sm font-semibold truncate">
          Chat history
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapsed}
          aria-label="Collapse chat history"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <div className="px-3 py-3">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-4">
          {loading && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
          )}
          {!loading && sessions.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet.</p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((session) => (
                  <SessionButton
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function ChatPage() {
  const { isCheckingAuth } = useRequireAuth();
  const queryClient = useQueryClient();
  usePageTitle("Chat — RecallMeet");

  /* ---- server data ---- */

  const {
    data: workspaces,
    isLoading: workspacesLoading,
    isError: workspacesError,
    refetch: refetchWorkspaces,
    isRefetching: workspacesRefetching,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await apiClient.get("/api/v1/workspaces")).data,
    enabled: !isCheckingAuth,
  });

  const workspaceId: string | undefined = workspaces?.[0]?.id;

  const { data: chatMeetings = [] } = useQuery<ChatMeeting[]>({
    queryKey: ["chat-meetings", workspaceId],
    queryFn: async () =>
      (await apiClient.get(`/api/v1/workspaces/${workspaceId}/chat/meetings`)).data,
    enabled: !!workspaceId,
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ["chat-sessions", workspaceId],
    queryFn: async () =>
      (await apiClient.get(`/api/v1/workspaces/${workspaceId}/chat/sessions`)).data,
    enabled: !!workspaceId,
  });

  /* ---- local state ---- */

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [selectedMeetingIds, setSelectedMeetingIds] = useState<string[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  /* ---- actions ---- */

  async function sendMessage() {
    if (!input.trim() || !workspaceId || sending) return;
    const question = input.trim();
    setInput("");
    setSending(true);
    setError(null);
    setRateLimited(false);

    setMessages((prev) => [...prev, { role: "user", content: question }]);

    try {
      const res = await apiClient.post(`/api/v1/workspaces/${workspaceId}/chat`, {
        question,
        session_id: sessionId,
        meeting_ids: selectedMeetingIds.length > 0 ? selectedMeetingIds : undefined,
      });
      const { session_id, answer, sources } = res.data;
      setSessionId(session_id);

      await queryClient.invalidateQueries({
        queryKey: ["chat-sessions", workspaceId],
      });
      setMessages((prev) => [...prev, { role: "assistant", content: answer, sources }]);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.response?.status === 429) {
        setRateLimited(true);
        const retry = apiError.response?.data?.retry_after_seconds ?? 60;
        setRetryAfter(retry);
        setError(`Rate limited. Try again in ${retry} seconds.`);
      } else {
        const detail =
          apiError.response?.data?.detail ?? "Something went wrong. Please try again.";
        setError(detail);
        toast.error(
          typeof detail === "string" ? detail : "Something went wrong. Please try again."
        );
      }
      setInput(question);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const toggleMeeting = useCallback((id: string) => {
    setSelectedMeetingIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }, []);

  const removeMeeting = useCallback((id: string) => {
    setSelectedMeetingIds((prev) => prev.filter((m) => m !== id));
  }, []);

  const clearAllMeetings = useCallback(() => setSelectedMeetingIds([]), []);

  const openSession = useCallback(
    async (id: string) => {
      if (id === sessionId || !workspaceId) return;
      setLoadingMessages(true);
      setError(null);
      try {
        const response = await apiClient.get(
          `/api/v1/workspaces/${workspaceId}/chat/sessions/${id}/messages`
        );
        setSessionId(id);
        setMessages(
          response.data.map(
            (m: { role: string; content: string; sources?: ChatSource[] }) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
              sources: m.sources ?? undefined,
            })
          )
        );
      } catch {
        setError("Couldn't load that conversation.");
        toast.error("Couldn't load that conversation.");
      } finally {
        setLoadingMessages(false);
      }
    },
    [sessionId, workspaceId]
  );

  const newChat = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setError(null);
    setInput("");
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeMobileHistory = useCallback(() => setMobileHistoryOpen(false), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending, loadingMessages]);

  /* ---- loading / error screens ---- */

  if (isCheckingAuth || workspacesLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (workspacesError || !workspaceId) {
    return (
      <div className="max-w-2xl mx-auto p-8 flex flex-col items-start gap-3">
        <p className="text-red-600">Couldn&apos;t load your account.</p>
        <Button
          variant="outline"
          onClick={() => refetchWorkspaces()}
          disabled={workspacesRefetching}
        >
          {workspacesRefetching ? "Retrying..." : "Retry"}
        </Button>
      </div>
    );
  }

  /* ---- main layout ---- */

  return (
    <div className="flex h-[calc(100vh-1rem)] overflow-hidden lg:h-screen">
      <style>{CHAT_CSS}</style>

      {/* Mobile history drawer */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setMobileHistoryOpen(true)}
          aria-label="Open chat history"
          className="fixed left-4 top-16 z-30 flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-border shadow-lg text-foreground"
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
        {mobileHistoryOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={closeMobileHistory}>
            <div
              className="rm-fade absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={closeMobileHistory}
              aria-hidden="true"
            />
            <div
              className="absolute inset-y-0 left-0 z-10 w-72 bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <ChatSidebar
                sessions={sessions}
                activeSessionId={sessionId}
                onSelect={(id) => {
                  openSession(id);
                  closeMobileHistory();
                }}
                onNewChat={() => {
                  newChat();
                  closeMobileHistory();
                }}
                collapsed={false}
                onToggleCollapsed={closeMobileHistory}
                loading={sessionsLoading}
              />
            </div>
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <ChatSidebar
          sessions={sessions}
          activeSessionId={sessionId}
          onSelect={openSession}
          onNewChat={newChat}
          collapsed={!sidebarOpen}
          onToggleCollapsed={toggleSidebar}
          loading={sessionsLoading}
        />
      </div>

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <span className="rm-gradient flex h-8 w-8 items-center justify-center rounded-lg">
                <MessageSquare className="w-4 h-4" />
              </span>
              <span className="rm-gradient-text">Meeting Chat</span>
            </h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCatalog((s) => !s)}
              className="gap-1"
            >
              {showCatalog ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              Meetings
            </Button>
          </div>

          {showCatalog && (
            <div className="mb-4">
              <MeetingCatalog
                meetings={chatMeetings}
                selectedMeetingIds={selectedMeetingIds}
                onToggleMeeting={toggleMeeting}
                onClearAll={clearAllMeetings}
              />
            </div>
          )}

          <SelectedMeetingsBar
            meetings={chatMeetings}
            selectedMeetingIds={selectedMeetingIds}
            onRemoveMeeting={removeMeeting}
          />

          {rateLimited && retryAfter && (
            <div className="rm-msg mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-center justify-between">
              <span>
                Rate limited. Please wait {retryAfter}s before sending another message.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRateLimited(false);
                  setRetryAfter(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          )}

          {error && !rateLimited && (
            <p key={error} className="rm-msg text-sm text-destructive mb-2">
              {error}
            </p>
          )}

          <div className="flex-1 min-h-0 mb-4">
            <MessageList
              messages={messages}
              sending={sending}
              loadingMessages={loadingMessages}
              bottomRef={bottomRef}
            />
          </div>

          <div className="rm-composer flex gap-2 rounded-xl border border-border bg-card p-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={rateLimited ? `Wait ${retryAfter}s…` : "Ask about your meetings…"}
              rows={2}
              disabled={sending || rateLimited}
              className="border-0 shadow-none focus-visible:ring-0 resize-none"
            />
            <Button
              onClick={sendMessage}
              disabled={sending || !input.trim() || rateLimited}
              className="rm-gradient rm-send self-end border-0"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}