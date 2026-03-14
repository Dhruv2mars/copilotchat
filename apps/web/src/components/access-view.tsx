import { Shield, Cookie, Terminal, AlertTriangle } from "lucide-react";

export function AccessView(props: { devCliAvailable: boolean }) {
  const items = [
    {
      icon: Shield,
      title: "Primary",
      description: "GitHub PAT with Models access, validated server-side."
    },
    {
      icon: Cookie,
      title: "Cookie",
      description: "Encrypted, http-only session cookie for GitHub access token."
    },
    {
      icon: Terminal,
      title: "Dev",
      description: props.devCliAvailable
        ? "Local GitHub CLI auth is enabled."
        : "Local GitHub CLI auth is disabled."
    },
    {
      icon: AlertTriangle,
      title: "Legacy",
      description: "Device flow hidden because it does not reliably grant Models API access."
    }
  ];

  return (
    <div className="flex flex-col h-full px-6 py-8 max-w-3xl mx-auto">
      <div className="space-y-2 mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Hosted access
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">PAT in, cookie out</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The app uses a hosted BFF for GitHub auth and model calls, so the browser never hits
          models.github.ai directly.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border bg-card p-5 space-y-3"
          >
            <div className="flex items-center gap-2">
              <item.icon className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">{item.title}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
