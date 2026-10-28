"use client";
// Dashboard home page.
//
// Layout (no boxes): a plain header with the stats written as one inline line,
// then the meetings as a flat timeline. Meetings that are still processing are
// pulled up into their own "In progress" group at the top.

import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useRequireAuth } from "@/lib/use-require-auth";
import { usePageTitle } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { UploadDialog } from "./upload-dialog";
import { PageContainer } from "@/components/layout";
import { ChevronDown, FileText, MessageSquare, type LucideIcon } from "lucide-react";
import {
  IN_PROGRESS_STATUSES,
  calculateTotalHours,
  MeetingCard,
  MeetingCardSkeleton,
} from "./components";

/* -------------------------------------------------------------------------- */
/* Types & constants                                                          */
/* -------------------------------------------------------------------------- */

type Workspace = {
  id: string;
  name: string;
  role: string;
};

type Meeting = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  source_media_type?: string;
};

const COMPLETED_STATUSES = ["ready", "completed"];
const POLL_INTERVAL_MS = 5000;
const SKELETON_COUNT = 5;

/** Colour of the timeline dot for each kind of status. */
function dotColor(status: string): string {
  if (IN_PROGRESS_STATUSES.includes(status)) return "#f59e0b"; // amber
  if (COMPLETED_STATUSES.includes(status)) return "#10b981"; // emerald
  if (status === "failed") return "#ef4444"; // red
  return "#14b8a6"; // teal
}

/* -------------------------------------------------------------------------- */
/* Animated colours + flat (box-free) styling                                 */
/* -------------------------------------------------------------------------- */

const DASHBOARD_CSS = `
@keyframes rm-gradient-shift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes rm-rise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes rm-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-6px); }
}
@keyframes rm-pulse-dot {
  0%   { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.6); }
  100% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
}
.rm-gradient-text {
  background-image: linear-gradient(120deg, #10b981, #f59e0b, #f43f5e, #84cc16, #10b981);
  background-size: 300% 300%;
  animation: rm-gradient-shift 10s ease infinite;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.rm-gradient-bar {
  height: 3px;
  border-radius: 9999px;
  background-image: linear-gradient(90deg, #10b981, #f59e0b, #f43f5e, #84cc16, #10b981);
  background-size: 300% 100%;
  animation: rm-gradient-shift 8s linear infinite;
}
.rm-rise {
  opacity: 0;
  animation: rm-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: var(--rm-delay, 0ms);
}
.rm-float { animation: rm-float 4s ease-in-out infinite; }

/* Timeline: one coloured line, a dot per meeting, no card boxes */
.rm-timeline {
  position: relative;
  padding-left: 28px;
}
.rm-timeline::before {
  content: "";
  position: absolute;
  left: 7px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 9999px;
  background-image: linear-gradient(180deg, #10b981, #f59e0b, #f43f5e, #84cc16);
  opacity: 0.55;
}
.rm-tl-item {
  position: relative;
  border-bottom: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
  transition: background-color 0.2s ease, padding-left 0.2s ease;
}
.rm-tl-item:last-child { border-bottom: 0; }
.rm-tl-item::before {
  content: "";
  position: absolute;
  left: -27px;
  top: 22px;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: var(--dot, #f59e0b);
  border: 2px solid var(--background);
}
.rm-tl-item.rm-live::before { animation: rm-pulse-dot 1.4s ease-out infinite; }
.rm-tl-item:hover {
  background-image: linear-gradient(90deg, rgba(16, 185, 129, 0.10), transparent 70%);
  padding-left: 6px;
}
/* Strip the box (border, fill, shadow, blur) from the existing meeting card */
.rm-flat > * {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .rm-gradient-text, .rm-gradient-bar, .rm-rise, .rm-float, .rm-tl-item.rm-live::before {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .rm-tl-item { transition: none !important; }
}
`;

function delay(ms: number): React.CSSProperties {
  return { ["--rm-delay" as string]: `${ms}ms` } as React.CSSProperties;
}

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function CenteredState({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <style>{DASHBOARD_CSS}</style>
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">{children}</div>
      </div>
    </PageContainer>
  );
}

function IconBadge({
  icon: Icon,
  size = "md",
  tone = "destructive",
  float = false,
}: {
  icon: LucideIcon;
  size?: "md" | "lg";
  tone?: "destructive" | "muted";
  float?: boolean;
}) {
  const box = size === "lg" ? "h-20 w-20 rounded-2xl" : "h-16 w-16 rounded-full";
  const icon = size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const colors =
    tone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : "bg-gradient-to-br from-emerald-500/15 via-amber-500/10 to-rose-500/15 text-amber-500";
  return (
    <div
      className={`mx-auto flex items-center justify-center ${box} ${colors} ${
        float ? "rm-float" : ""
      }`}
    >
      <Icon className={icon} />
    </div>
  );
}

/** One figure in the inline stats line: big number, small label, optional trend. */
function InlineStat({
  value,
  label,
  color,
  trend,
  trendLabel,
}: {
  value: number | string;
  label: string;
  color: string;
  trend?: string;
  trendLabel?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 border-l border-border pl-5 first:border-l-0 first:pl-0">
      <span className={`text-3xl font-bold leading-none tracking-tight ${color}`}>
        {value}
      </span>
      <span className="text-sm text-muted-foreground">
        {label}
        {trend && (
          <span className="ml-2 text-xs">
            <span className="font-semibold text-emerald-500">{trend}</span> {trendLabel}
          </span>
        )}
      </span>
    </div>
  );
}

/** Stats written as one open line, no cards. */
function StatsLine({ meetings }: { meetings: Meeting[] | undefined }) {
  // One pass over the list instead of filtering twice on every render.
  const { total, processing, completed, hours } = useMemo(() => {
    let processingCount = 0;
    let completedCount = 0;
    for (const m of meetings ?? []) {
      if (IN_PROGRESS_STATUSES.includes(m.status)) processingCount++;
      if (COMPLETED_STATUSES.includes(m.status)) completedCount++;
    }
    return {
      total: meetings?.length || 0,
      processing: processingCount,
      completed: completedCount,
      hours: calculateTotalHours(meetings),
    };
  }, [meetings]);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
      <InlineStat
        value={total}
        label="Total Meetings"
        color="text-teal-500"
        trend="+12%"
        trendLabel="vs last month"
      />
      <InlineStat
        value={hours}
        label="Hours Recorded"
        color="text-rose-500"
        trend="+8%"
        trendLabel="vs last month"
      />
      <InlineStat value={processing} label="Processing" color="text-amber-500" />
      <InlineStat value={completed} label="Completed" color="text-emerald-500" />
    </div>
  );
}

function GroupLabel({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div className="mb-1 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {live && <span className="h-2 w-2 rounded-full bg-amber-500" />}
      {children}
    </div>
  );
}

function TimelineRows({
  meetings,
  workspaceId,
  startIndex = 0,
}: {
  meetings: Meeting[];
  workspaceId: string;
  startIndex?: number;
}) {
  return (
    <div className="rm-timeline">
      {meetings.map((meeting, i) => (
        <div
          key={meeting.id}
          className={`rm-rise rm-tl-item ${
            IN_PROGRESS_STATUSES.includes(meeting.status) ? "rm-live" : ""
          }`}
          // Cap the stagger so long lists don't wait seconds to appear.
          style={{
            ...delay(Math.min(startIndex + i, 8) * 50),
            ["--dot" as string]: dotColor(meeting.status),
          }}
        >
          <div className="rm-flat min-w-0">
            <MeetingCard meeting={meeting} workspaceId={workspaceId} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MeetingsSection({
  meetings,
  isLoading,
  isError,
  workspaceId,
}: {
  meetings: Meeting[] | undefined;
  isLoading: boolean;
  isError: boolean;
  workspaceId: string;
}) {
  // In-progress meetings first, everything else after (order inside each group kept).
  const { active, rest } = useMemo(() => {
    const activeList: Meeting[] = [];
    const restList: Meeting[] = [];
    for (const m of meetings ?? []) {
      (IN_PROGRESS_STATUSES.includes(m.status) ? activeList : restList).push(m);
    }
    return { active: activeList, rest: restList };
  }, [meetings]);

  if (isLoading) {
    return (
      <div className="rm-timeline">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="rm-tl-item rm-flat" style={{ ["--dot" as string]: "#6ee7b7" }}>
            <MeetingCardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center">
        <IconBadge icon={FileText} />
        <h3 className="mt-4 text-lg font-medium">Couldn&apos;t load meetings</h3>
        <p className="mt-1 text-muted-foreground">Try refreshing the page.</p>
      </div>
    );
  }

  if (!meetings || meetings.length === 0) {
    return (
      <div className="rm-rise py-16 text-center">
        <IconBadge icon={MessageSquare} size="lg" tone="muted" float />
        <h3 className="mt-6 text-xl font-semibold">No meetings yet</h3>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          Upload your first meeting recording to get started with AI-powered summaries,
          action items, and chat.
        </p>
        <UploadDialog workspaceId={workspaceId} className="mt-6" />
      </div>
    );
  }

  return (
    <div>
      {active.length > 0 && (
        <>
          <GroupLabel live>In progress · {active.length}</GroupLabel>
          <TimelineRows meetings={active} workspaceId={workspaceId} />
        </>
      )}
      {rest.length > 0 && (
        <>
          <GroupLabel>
            {active.length > 0 ? "Everything else" : "All meetings"} · {rest.length}
          </GroupLabel>
          <TimelineRows meetings={rest} workspaceId={workspaceId} startIndex={active.length} />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const { isCheckingAuth } = useRequireAuth();
  const router = useRouter();
  usePageTitle("Dashboard — RecallMeet");
  const logout = useAuthStore((state) => state.logout);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const {
    data: workspaces,
    isLoading: workspacesLoading,
    isError: workspacesError,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const response = await apiClient.get<Workspace[]>("/api/v1/workspaces");
      return response.data;
    },
    enabled: !isCheckingAuth,
  });

  const workspaceId = workspaces?.[0]?.id;

  const {
    data: meetings,
    isLoading: meetingsLoading,
    isError: meetingsError,
  } = useQuery({
    queryKey: ["meetings", workspaceId],
    queryFn: async () => {
      const response = await apiClient.get<Meeting[]>(
        `/api/v1/workspaces/${workspaceId}/meetings`
      );
      return response.data;
    },
    enabled: !!workspaceId,
    // Keep polling every 5s while any meeting is still being processed.
    refetchInterval: (query) => {
      const currentMeetings = query.state.data as Meeting[] | undefined;
      const stillProcessing = currentMeetings?.some((m) =>
        IN_PROGRESS_STATUSES.includes(m.status)
      );
      return stillProcessing ? POLL_INTERVAL_MS : false;
    },
  });

  if (isCheckingAuth || workspacesLoading) {
    return (
      <CenteredState>
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Loading your workspace...</p>
      </CenteredState>
    );
  }

  if (workspacesError || !workspaceId) {
    return (
      <CenteredState>
        <IconBadge icon={FileText} />
        <h2 className="mt-4 text-xl font-semibold">Couldn&apos;t load your account</h2>
        <p className="mt-2 text-muted-foreground">
          Try refreshing the page or sign in again.
        </p>
        <Button onClick={handleLogout} className="mt-6" variant="outline">
          Sign out
        </Button>
      </CenteredState>
    );
  }

  return (
    <PageContainer maxWidth="5xl">
      <style>{DASHBOARD_CSS}</style>

      {/* Header: title + description, the inline stats line, upload on the right */}
      <header className="rm-rise flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="rm-gradient-text inline-block text-4xl font-bold tracking-tight">
            Dashboard
          </h1>
          <p className="mt-1 text-muted-foreground">
            Overview of your meetings and workspace activity
          </p>
          <div className="mt-6">
            <StatsLine meetings={meetings} />
          </div>
        </div>
        <div className="shrink-0">
          <UploadDialog workspaceId={workspaceId} />
        </div>
      </header>

      <div className="rm-gradient-bar my-8" />

      {/* Meetings */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Recent Meetings</h2>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="hidden sm:flex">
              <ChevronDown className="mr-1 h-4 w-4" /> Sort by date
            </Button>
            <Button variant="ghost" size="sm" className="hidden sm:flex">
              <ChevronDown className="mr-1 h-4 w-4" /> All statuses
            </Button>
          </div>
        </div>
        <MeetingsSection
          meetings={meetings}
          isLoading={meetingsLoading}
          isError={meetingsError}
          workspaceId={workspaceId}
        />
      </section>
    </PageContainer>
  );
}