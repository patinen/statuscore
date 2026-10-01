"use client";

import { useEffect, useMemo, useState } from "react";

type User = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type Monitor = {
  id: string;
  name: string;
  url: string;
  method: string;
  enabled: boolean;
  currentStatus: string;
  expectedStatusCode: number;
  intervalSeconds: number;
  timeoutMs: number;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

const StatusBadge = ({ label }: { label: string }) => (
  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-300">
    {label}
  </span>
);

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState("StatusCore API");
  const [url, setUrl] = useState("https://example.com");
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = Boolean(user);

  const headerLabel = useMemo(() => (isAuthenticated ? "Connected" : "Self-hosted"), [isAuthenticated]);

  const loadSession = async () => {
    try {
      const currentUser = await apiRequest<User>("/auth/me");
      setUser(currentUser);
      const list = await apiRequest<Monitor[]>("/monitors");
      setMonitors(list ?? []);
      setError(null);
    } catch {
      setUser(null);
      setMonitors([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const handleLogin = () => {
    window.location.href = `${apiBaseUrl}/auth/github`;
  };

  const handleLogout = async () => {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
      setUser(null);
      setMonitors([]);
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Unable to log out.");
    }
  };

  const handleCreateMonitor = async () => {
    try {
      setError(null);
      const created = await apiRequest<Monitor>("/monitors", {
        method: "POST",
        body: JSON.stringify({
          name,
          url,
          method: "GET",
          expectedStatusCode: 200,
          intervalSeconds: 60,
          timeoutMs: 10000,
          failureThreshold: 3,
          enabled: true,
        }),
      });

      setMonitors((currentMonitors) => [created, ...currentMonitors]);
      setName("StatusCore API");
      setUrl("https://example.com");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create monitor.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0d10] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-zinc-800/80 bg-[#0b0d10]/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 text-zinc-100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M4 16.5V8.5a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                  <path d="M9 10.5h6M8 13.5h8" />
                </svg>
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight text-white">StatusCore</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge label={headerLabel} />
              {user ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-500"
                >
                  Log out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleLogin}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-500"
                >
                  Sign in with GitHub
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex flex-1 px-4 py-12 sm:px-6 lg:px-8">
          <section className="w-full max-w-6xl rounded-xl border border-zinc-800 bg-[#101317] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">Operations</span>
              </div>
              {user ? (
                <div className="flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.login} className="h-7 w-7 rounded-full" />
                  ) : null}
                  <span>{user.name ?? user.login}</span>
                </div>
              ) : null}
            </div>

            {isLoading ? (
              <div className="rounded-lg border border-zinc-700 bg-zinc-950/40 p-6 text-zinc-300">Checking session…</div>
            ) : !isAuthenticated ? (
              <div className="space-y-5">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
                  Self-hosted service monitoring and incident tracking.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                  Sign in with GitHub to create and manage the monitors that keep your services healthy.
                </p>
                <div className="mt-6 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-left">
                  <h2 className="text-xl font-medium text-zinc-50">No active session.</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">
                    Your monitoring dashboard unlocks after authentication.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-4 rounded-lg border border-zinc-700 bg-zinc-950/40 p-5">
                    <h2 className="text-xl font-medium text-zinc-50">Create monitor</h2>

                    <div className="space-y-4">
                      <label className="block text-sm text-zinc-300">
                        Name
                        <input
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100 outline-none ring-0 placeholder:text-zinc-500"
                          placeholder="StatusCore API"
                        />
                      </label>

                      <label className="block text-sm text-zinc-300">
                        Target URL
                        <input
                          value={url}
                          onChange={(event) => setUrl(event.target.value)}
                          className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100 outline-none ring-0 placeholder:text-zinc-500"
                          placeholder="https://example.com"
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={handleCreateMonitor}
                      className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
                    >
                      Add monitor
                    </button>
                  </div>

                  <div className="rounded-lg border border-zinc-700 bg-zinc-950/40 p-5">
                    <h2 className="text-xl font-medium text-zinc-50">Overview</h2>
                    <div className="mt-4 space-y-3 text-sm text-zinc-300">
                      <div className="flex items-center justify-between">
                        <span>Total monitors</span>
                        <strong className="text-zinc-50">{monitors.length}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Healthy</span>
                        <strong className="text-emerald-400">{monitors.filter((monitor) => monitor.currentStatus === "UP").length}</strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Unknown</span>
                        <strong className="text-zinc-200">{monitors.filter((monitor) => monitor.currentStatus === "UNKNOWN").length}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-lg border border-red-700/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                <div className="space-y-4">
                  <h2 className="text-xl font-medium text-zinc-50">Monitors</h2>

                  {monitors.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-left">
                      <h3 className="text-lg font-medium text-zinc-50">No monitors yet.</h3>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Add a service to begin monitoring uptime and response time.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {monitors.map((monitor) => (
                        <div key={monitor.id} className="rounded-lg border border-zinc-700 bg-zinc-950/30 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-medium text-zinc-50">{monitor.name}</h3>
                              <p className="mt-1 text-sm text-zinc-400">{monitor.url}</p>
                            </div>
                            <span
                              className={[
                                "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em]",
                                monitor.currentStatus === "UP"
                                  ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                                  : "border border-zinc-700 bg-zinc-900 text-zinc-300",
                              ].join(" ")}
                            >
                              {monitor.currentStatus}
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-zinc-300">
                            <div>
                              <span className="text-zinc-500">Method</span>
                              <div className="mt-1 text-zinc-100">{monitor.method}</div>
                            </div>
                            <div>
                              <span className="text-zinc-500">Interval</span>
                              <div className="mt-1 text-zinc-100">{monitor.intervalSeconds}s</div>
                            </div>
                            <div>
                              <span className="text-zinc-500">Timeout</span>
                              <div className="mt-1 text-zinc-100">{monitor.timeoutMs}ms</div>
                            </div>
                            <div>
                              <span className="text-zinc-500">Status</span>
                              <div className="mt-1 text-zinc-100">{monitor.expectedStatusCode}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
