import type { BridgeState } from "@copilotchat/shared";

export function DiagnosticsView(props: {
  accountLabel: string;
  bridgeState: BridgeState;
  models: { availability: "available" | "unsupported"; id: string; label: string }[];
  runtime: "bridge_offline" | "loading" | "ready" | "signed_out";
}) {
  const facts = [
    { label: "Authenticated", value: props.runtime === "ready" ? "yes" : "no" },
    { label: "Runtime", value: props.runtime },
    { label: "Account", value: props.accountLabel },
    { label: "Bridge", value: props.bridgeState.reachable ? "reachable" : "offline" },
    { label: "Bridge access", value: props.bridgeState.permission ?? "n/a" },
    { label: "Paired", value: props.bridgeState.paired ? "yes" : "no" },
    { label: "Bridge version", value: props.bridgeState.bridgeVersion ?? "unknown" },
    { label: "Protocol", value: props.bridgeState.protocolVersion ?? "unknown" },
    {
      label: "Models",
      value: props.models.length
        ? props.models
            .map((model) =>
              model.availability === "available" ? model.label : `${model.label} (unavailable)`
            )
            .join(", ")
        : "none"
    }
  ];

  return (
    <div className="flex h-full max-w-3xl flex-col mx-auto px-6 py-8">
      <div className="mb-8 space-y-2">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Diagnostics
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">Bridge facts</h2>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-xl border bg-card p-5 space-y-2">
            <dt className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {fact.label}
            </dt>
            <dd className="m-0 text-base font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
