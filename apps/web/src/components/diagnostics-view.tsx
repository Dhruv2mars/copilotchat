export function DiagnosticsView(props: {
  accountLabel: string;
  devCliAvailable: boolean;
  models: { id: string; label: string }[];
  runtime: "loading" | "ready" | "signed_out";
}) {
  const facts = [
    { label: "Authenticated", value: props.runtime === "ready" ? "yes" : "no" },
    { label: "Runtime", value: props.runtime },
    { label: "Account", value: props.accountLabel },
    { label: "Dev CLI", value: props.devCliAvailable ? "enabled" : "disabled" },
    {
      label: "Models",
      value: props.models.length
        ? props.models.map((model) => model.label).join(", ")
        : "none"
    }
  ];

  return (
    <div className="flex flex-col h-full px-6 py-8 max-w-3xl mx-auto">
      <div className="space-y-2 mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Diagnostics
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">Session facts</h2>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-xl border bg-card p-5 space-y-2">
            <dt className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {fact.label}
            </dt>
            <dd className="text-base font-medium m-0">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
