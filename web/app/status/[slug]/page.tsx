"use client";

import { use, useEffect, useMemo, useState } from "react";

type PublicMonitorStatus = "OPERATIONAL" | "OUTAGE" | "MAINTENANCE" | "UNKNOWN";
type PublicPageStatus = "OPERATIONAL" | "OUTAGE" | "DEGRADED" | "MAINTENANCE" | "UNKNOWN";

type PublicManualIncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
type PublicManualIncidentImpact = "DEGRADED" | "PARTIAL_OUTAGE" | "MAJOR_OUTAGE";

type PublicStatusPageResponse = {
  page: {
    name: string;
    slug: string;
    description: string | null;
    updatedAt: string;
  };
  overallStatus: PublicPageStatus;
  monitors: Array<{
    name: string;
    status: PublicMonitorStatus;
    lastCheckedAt: string | null;
  }>;
  activeIncidents: Array<{
    monitorName: string;
    startedAt: string;
    reason: string | null;
  }>;
  recentIncidents: Array<{
    monitorName: string;
    startedAt: string;
    resolvedAt: string | null;
    reason: string | null;
    durationMs: number;
  }>;
  activeMaintenance: Array<{
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    monitors: string[];
  }>;
  manualIncidents: Array<{
    title: string;
    impact: PublicManualIncidentImpact;
    status: PublicManualIncidentStatus;
    startedAt: string;
    resolvedAt: string | null;
    monitors: string[];
    updates: Array<{
      status: PublicManualIncidentStatus;
      message: string;
      createdAt: string;
    }>;
  }>;
  recentResolvedManualIncidents: Array<{
    title: string;
    impact: PublicManualIncidentImpact;
    status: PublicManualIncidentStatus;
    startedAt: string;
    resolvedAt: string | null;
    monitors: string[];
    updates: Array<{
      status: PublicManualIncidentStatus;
      message: string;
      createdAt: string;
    }>;
  }>;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function fetchPublicStatusPage(slug: string): Promise<PublicStatusPageResponse> {
  const response = await fetch(`${apiBaseUrl}/public/status-pages/${slug}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(String(response.status));
  }

  return response.json() as Promise<PublicStatusPageResponse>;
}

const statusCopy: Record<PublicPageStatus, { label: string; bannerClass: string }> = {
  OPERATIONAL: {
    label: "All systems operational",
    bannerClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  },
  MAINTENANCE: {
    label: "Scheduled maintenance",
    bannerClass: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  },
  DEGRADED: {
    label: "Partial service degradation",
    bannerClass: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  },
  OUTAGE: {
    label: "Service outage",
    bannerClass: "border-red-500/30 bg-red-500/10 text-red-200",
  },
  UNKNOWN: {
    label: "Status unknown",
    bannerClass: "border-zinc-500/30 bg-zinc-500/10 text-zinc-200",
  },
};

const manualImpactBadgeClass: Record<PublicManualIncidentImpact, string> = {
  MAJOR_OUTAGE: "border-red-500/30 bg-red-500/10 text-red-200",
  PARTIAL_OUTAGE: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  DEGRADED: "border-yellow-500/30 bg-yellow-500/10 text-yellow-200",
};

const monitorCopy: Record<PublicMonitorStatus, { label: string; className: string }> = {
  OPERATIONAL: {
    label: "Operational",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  },
  OUTAGE: {
    label: "Outage",
    className: "border-red-500/30 bg-red-500/10 text-red-200",
  },
  MAINTENANCE: {
    label: "Maintenance",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  },
  UNKNOWN: {
    label: "Unknown",
    className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-200",
  },
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export default function PublicStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params);
  const [page, setPage] = useState<PublicStatusPageResponse | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const slug = resolvedParams.slug;
  const banner = useMemo(() => (page ? statusCopy[page.overallStatus] : statusCopy.UNKNOWN), [page]);

  useEffect(() => {
    let cancelled = false;

    const loadPage = async () => {
      try {
        const nextPage = await fetchPublicStatusPage(slug);
        if (cancelled) {
          return;
        }

        setPage(nextPage);
        setIsNotFound(false);
        setIsUnavailable(false);
        setLastUpdated(new Date().toISOString());
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof Error && error.message === "404") {
          setIsNotFound(true);
          setPage(null);
        } else {
          setIsUnavailable(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPage();
    const intervalId = window.setInterval(() => {
      void loadPage();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [slug]);

  if (isLoading && !page) {
    return (
      <main className="min-h-screen bg-[#0b0d10] px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
          <div className="w-full rounded-2xl border border-zinc-800 bg-[#101317] p-8 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="text-xs font-medium uppercase tracking-[0.35em] text-zinc-500">StatusCore</div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Loading status page…</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Fetching current service and incident status.</p>
          </div>
        </div>
      </main>
    );
  }

  if (isNotFound) {
    return (
      <main className="min-h-screen bg-[#0b0d10] px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
          <div className="w-full rounded-2xl border border-zinc-800 bg-[#101317] p-8 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="text-xs font-medium uppercase tracking-[0.35em] text-zinc-500">StatusCore</div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Status page not found</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              This public status page does not exist or is not currently enabled.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (isUnavailable && !page) {
    return (
      <main className="min-h-screen bg-[#0b0d10] px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
          <div className="w-full rounded-2xl border border-zinc-800 bg-[#101317] p-8 text-center shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="text-xs font-medium uppercase tracking-[0.35em] text-zinc-500">StatusCore</div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">Status information is temporarily unavailable.</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              The public status service could not be reached. The page will keep retrying automatically.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0d10] px-4 py-8 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
        <header className="mb-8 rounded-2xl border border-zinc-800 bg-[#101317] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.35em] text-zinc-500">StatusCore / {page?.page.name ?? slug}</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {page?.page.name ?? "Status page"}
              </h1>
              {page?.page.description ? (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{page.page.description}</p>
              ) : null}
            </div>

            <div className={[
              "inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium",
              banner.bannerClass,
            ].join(" ")}>
              {banner.label}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 text-xs text-zinc-400">
            <span>Slug: /status/{page?.page.slug ?? slug}</span>
            <span>Last updated: {formatDateTime(lastUpdated ?? page?.page.updatedAt ?? null)}</span>
            {isLoading ? <span>Refreshing…</span> : null}
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {page?.monitors.length ? (
            page.monitors.map((monitor) => (
              <article key={`${monitor.name}-${monitor.lastCheckedAt ?? 'never'}`} className="rounded-2xl border border-zinc-800 bg-[#101317] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium text-white">{monitor.name}</h2>
                    <p className="mt-1 text-sm text-zinc-400">Last checked {formatDateTime(monitor.lastCheckedAt)}</p>
                  </div>
                  <span className={[
                    "rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em]",
                    monitorCopy[monitor.status].className,
                  ].join(" ")}>
                    {monitorCopy[monitor.status].label}
                  </span>
                </div>
              </article>
            ))
          ) : (
            <article className="md:col-span-2 rounded-2xl border border-zinc-800 bg-[#101317] p-5 text-sm text-zinc-400 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
              No services have been added to this status page.
            </article>
          )}
        </section>

        {page?.activeMaintenance.length ? (
          <section className="mt-8 rounded-2xl border border-zinc-800 bg-[#101317] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <h2 className="text-lg font-medium text-white">Active maintenance</h2>
            <div className="mt-4 space-y-3">
              {page.activeMaintenance.map((maintenance) => (
                <div key={`${maintenance.title}-${maintenance.startsAt}`} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-blue-100">{maintenance.title}</div>
                      <div className="mt-1 text-xs text-blue-200/80">
                        {formatDateTime(maintenance.startsAt)} to {formatDateTime(maintenance.endsAt)}
                      </div>
                    </div>
                    <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-blue-200">
                      Scheduled maintenance
                    </span>
                  </div>
                  {maintenance.description ? <div className="mt-2 text-sm text-blue-100/90">{maintenance.description}</div> : null}
                  <div className="mt-2 text-xs text-blue-100/80">
                    Affected services: {maintenance.monitors.length > 0 ? maintenance.monitors.join(", ") : "None"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {page?.manualIncidents.length ? (
          <section className="mt-8 rounded-2xl border border-zinc-800 bg-[#101317] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <h2 className="text-lg font-medium text-white">Active manual incidents</h2>
            <div className="mt-4 space-y-4">
              {page.manualIncidents.map((incident) => (
                <article key={`${incident.title}-${incident.startedAt}`} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-medium text-amber-100">{incident.title}</h3>
                      <div className="mt-1 text-xs text-amber-200/80">Started {formatDateTime(incident.startedAt)}</div>
                      <div className="mt-1 text-xs text-amber-100/80">
                        Affected services: {incident.monitors.length > 0 ? incident.monitors.join(", ") : "None"}
                      </div>
                    </div>
                    <span className={[
                      "rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em]",
                      manualImpactBadgeClass[incident.impact],
                    ].join(" ")}>
                      {incident.impact.replaceAll("_", " ")}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {incident.updates.map((update) => (
                      <div key={`${incident.title}-${update.createdAt}-${update.status}`} className="rounded-md border border-zinc-700/60 bg-zinc-950/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-300">{update.status}</span>
                          <span className="text-xs text-zinc-400">{formatDateTime(update.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-sm text-zinc-200">{update.message}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800 bg-[#101317] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <h2 className="text-lg font-medium text-white">Active incidents</h2>
            <div className="mt-4 space-y-3">
              {page?.activeIncidents.length ? (
                page.activeIncidents.map((incident) => (
                  <div key={`${incident.monitorName}-${incident.startedAt}`} className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                    <div className="text-sm font-medium text-red-100">{incident.monitorName}</div>
                    <div className="mt-1 text-xs text-red-200/80">Started {formatDateTime(incident.startedAt)}</div>
                    {incident.reason ? <div className="mt-2 text-sm text-red-100/90">{incident.reason}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-zinc-400">No active incidents.</div>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-800 bg-[#101317] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <h2 className="text-lg font-medium text-white">Recent incidents</h2>
            <div className="mt-4 space-y-3">
              {page?.recentIncidents.length ? (
                page.recentIncidents.map((incident) => (
                  <div key={`${incident.monitorName}-${incident.startedAt}`} className="rounded-xl border border-zinc-700 bg-zinc-950/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-zinc-100">{incident.monitorName}</div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {formatDateTime(incident.startedAt)} · {formatDateTime(incident.resolvedAt)}
                        </div>
                      </div>
                      <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-300">
                        {Math.max(0, Math.floor(incident.durationMs / 1000))}s
                      </span>
                    </div>
                    {incident.reason ? <div className="mt-2 text-sm text-zinc-300">{incident.reason}</div> : null}
                  </div>
                ))
              ) : (
                <div className="text-sm text-zinc-400">No recent incidents.</div>
              )}
            </div>
          </article>
        </section>

        {page?.recentResolvedManualIncidents.length ? (
          <section className="mt-8 rounded-2xl border border-zinc-800 bg-[#101317] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <h2 className="text-lg font-medium text-white">Recent resolved manual incidents</h2>
            <div className="mt-4 space-y-4">
              {page.recentResolvedManualIncidents.map((incident) => (
                <article key={`${incident.title}-${incident.resolvedAt ?? incident.startedAt}`} className="rounded-xl border border-zinc-700 bg-zinc-950/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-medium text-zinc-100">{incident.title}</h3>
                      <div className="mt-1 text-xs text-zinc-400">
                        {formatDateTime(incident.startedAt)} to {formatDateTime(incident.resolvedAt)}
                      </div>
                      <div className="mt-1 text-xs text-zinc-300/80">
                        Affected services: {incident.monitors.length > 0 ? incident.monitors.join(", ") : "None"}
                      </div>
                    </div>
                    <span className={[
                      "rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em]",
                      manualImpactBadgeClass[incident.impact],
                    ].join(" ")}>
                      {incident.impact.replaceAll("_", " ")}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {incident.updates.map((update) => (
                      <div key={`${incident.title}-${update.createdAt}-${update.status}`} className="rounded-md border border-zinc-700/60 bg-zinc-900/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-300">{update.status}</span>
                          <span className="text-xs text-zinc-400">{formatDateTime(update.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-sm text-zinc-200">{update.message}</div>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}