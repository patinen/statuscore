const StatusBadge = ({ label }: { label: string }) => (
  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-300">
    {label}
  </span>
);

export default function Home() {
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

            <StatusBadge label="Self-hosted" />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
          <section className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-[#101317] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-500" aria-hidden="true" />
              <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400">Operations</span>
            </div>

            <div className="space-y-5">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
                Self-hosted service monitoring and incident tracking.
              </h1>

              <p className="max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                StatusCore is being initialized for reliable uptime checks and service visibility. There are no monitors configured yet.
              </p>
            </div>

            <div className="mt-8 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-left">
              <h2 className="text-xl font-medium text-zinc-50">No monitors yet.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">
                Add a service to begin monitoring uptime and response time.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
