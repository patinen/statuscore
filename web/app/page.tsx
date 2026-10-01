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
  method: "GET" | "HEAD";
  enabled: boolean;
  currentStatus: string;
  expectedStatusCode: number;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  lastCheckedAt: string | null;
};

type MonitorForm = {
  name: string;
  url: string;
  method: "GET" | "HEAD";
  expectedStatusCode: number;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  enabled: boolean;
};

const defaultForm: MonitorForm = {
  name: "StatusCore API",
  url: "https://example.com",
  method: "GET",
  expectedStatusCode: 200,
  intervalSeconds: 60,
  timeoutMs: 10000,
  failureThreshold: 3,
  enabled: true,
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
  const [form, setForm] = useState<MonitorForm>(defaultForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = Boolean(user);
  const headerLabel = useMemo(() => (isAuthenticated ? "Connected" : "Self-hosted"), [isAuthenticated]);

  useEffect(() => {
    let isActive = true;

    const loadSession = async () => {
      try {
        const currentUser = await apiRequest<User>("/auth/me");
        if (!isActive) {
          return;
        }

        setUser(currentUser);
        const list = await apiRequest<Monitor[]>("/monitors");
        if (!isActive) {
          return;
        }

        setMonitors(list ?? []);
        setError(null);
      } catch {
        if (!isActive) {
          return;
        }

        setUser(null);
        setMonitors([]);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadSession();

    return () => {
      isActive = false;
    };
  }, []);

  const resetForm = () => {
    setForm(defaultForm);
    setEditingId(null);
  };

  const updateForm = <K extends keyof MonitorForm>(key: K, value: MonitorForm[K]) => {
    setForm((currentForm) => ({ ...currentForm, [key]: value }));
  };

  const handleLogin = () => {
    window.open(`${apiBaseUrl}/auth/github`, "_self");
  };

  const handleLogout = async () => {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
      setUser(null);
      setMonitors([]);
      resetForm();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Unable to log out.");
    }
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      const payload = {
        ...form,
        name: form.name.trim(),
      };

      const monitor = editingId
        ? await apiRequest<Monitor>(`/monitors/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          })
        : await apiRequest<Monitor>("/monitors", {
            method: "POST",
            body: JSON.stringify(payload),
          });

      setMonitors((currentMonitors) => {
        if (editingId) {
          return currentMonitors.map((item) => (item.id === editingId ? monitor : item));
        }

        return [monitor, ...currentMonitors];
      });

      resetForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save monitor.");
    }
  };

  const handleDelete = async (monitorId: string) => {
    const target = monitors.find((monitor) => monitor.id === monitorId);
    if (!target || !window.confirm(`Delete ${target.name}? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      await apiRequest<void>(`/monitors/${monitorId}`, { method: "DELETE" });
      setMonitors((currentMonitors) => currentMonitors.filter((monitor) => monitor.id !== monitorId));
      if (editingId === monitorId) {
        resetForm();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete monitor.");
    }
  };

  const handleEnableToggle = async (monitor: Monitor) => {
    try {
      const updated = await apiRequest<Monitor>(`/monitors/${monitor.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !monitor.enabled }),
      });

      setMonitors((currentMonitors) =>
        currentMonitors.map((item) => (item.id === monitor.id ? updated : item)),
      );
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update monitor.");
    }
  };

  const beginEdit = (monitor: Monitor) => {
    setEditingId(monitor.id);
    setForm({
      name: monitor.name,
      url: monitor.url,
      method: monitor.method,
      expectedStatusCode: monitor.expectedStatusCode,
      intervalSeconds: monitor.intervalSeconds,
      timeoutMs: monitor.timeoutMs,
      failureThreshold: monitor.failureThreshold,
      enabled: monitor.enabled,
    });
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
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-[10px] font-semibold uppercase tracking-wide text-zinc-100"
                    aria-label={user.login}
                  >
                    {(user.name ?? user.login).slice(0, 1).toUpperCase()}
                  </div>
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
                <div className="rounded-lg border border-zinc-700 bg-zinc-950/40 p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-xl font-medium text-zinc-50">
                      {editingId ? "Edit monitor" : "Create monitor"}
                    </h2>
                    {editingId ? (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                      >
                        Cancel edit
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm text-zinc-300">
                      Name
                      <input
                        value={form.name}
                        onChange={(event) => updateForm("name", event.target.value)}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100 outline-none ring-0 placeholder:text-zinc-500"
                        placeholder="StatusCore API"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      URL
                      <input
                        value={form.url}
                        onChange={(event) => updateForm("url", event.target.value)}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100 outline-none ring-0 placeholder:text-zinc-500"
                        placeholder="https://example.com"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      HTTP method
                      <select
                        value={form.method}
                        onChange={(event) => updateForm("method", event.target.value as "GET" | "HEAD")}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100"
                      >
                        <option value="GET">GET</option>
                        <option value="HEAD">HEAD</option>
                      </select>
                    </label>

                    <label className="block text-sm text-zinc-300">
                      Expected status code
                      <input
                        type="number"
                        min={100}
                        max={599}
                        value={form.expectedStatusCode}
                        onChange={(event) => updateForm("expectedStatusCode", Number(event.target.value))}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      Check interval (seconds)
                      <input
                        type="number"
                        min={60}
                        max={86400}
                        value={form.intervalSeconds}
                        onChange={(event) => updateForm("intervalSeconds", Number(event.target.value))}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      Timeout (ms)
                      <input
                        type="number"
                        min={1000}
                        max={30000}
                        value={form.timeoutMs}
                        onChange={(event) => updateForm("timeoutMs", Number(event.target.value))}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100"
                      />
                    </label>

                    <label className="block text-sm text-zinc-300">
                      Failure threshold
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={form.failureThreshold}
                        onChange={(event) => updateForm("failureThreshold", Number(event.target.value))}
                        className="mt-2 w-full rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-2 text-zinc-100"
                      />
                    </label>

                    <label className="flex items-center justify-between rounded-md border border-zinc-700 bg-[#070a0d] px-3 py-3 text-sm text-zinc-300">
                      Enabled
                      <input
                        type="checkbox"
                        checked={form.enabled}
                        onChange={(event) => updateForm("enabled", event.target.checked)}
                        className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-emerald-400"
                      />
                    </label>
                  </div>

                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
                    >
                      {editingId ? "Save monitor" : "Add monitor"}
                    </button>
                    {editingId ? (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200"
                      >
                        Reset
                      </button>
                    ) : null}
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
                              <span className="text-zinc-500">Status</span>
                              <div className="mt-1 text-zinc-100">{monitor.enabled ? "Enabled" : "Disabled"}</div>
                            </div>
                            <div>
                              <span className="text-zinc-500">Method</span>
                              <div className="mt-1 text-zinc-100">{monitor.method}</div>
                            </div>
                            <div>
                              <span className="text-zinc-500">Interval</span>
                              <div className="mt-1 text-zinc-100">{monitor.intervalSeconds}s</div>
                            </div>
                            <div>
                              <span className="text-zinc-500">Expected</span>
                              <div className="mt-1 text-zinc-100">{monitor.expectedStatusCode}</div>
                            </div>
                            <div className="col-span-2">
                              <span className="text-zinc-500">Last checked</span>
                              <div className="mt-1 text-zinc-100">
                                {monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).toLocaleString() : "Never checked"}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleEnableToggle(monitor)}
                              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                            >
                              {monitor.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              onClick={() => beginEdit(monitor)}
                              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(monitor.id)}
                              className="rounded-md border border-red-700 bg-red-950/30 px-3 py-2 text-sm text-red-200"
                            >
                              Delete
                            </button>
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
