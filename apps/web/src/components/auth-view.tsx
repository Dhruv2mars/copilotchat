import { ExternalLink, LaptopMinimal, Link2 } from "lucide-react";

import type { AuthDeviceStartResponse } from "@copilotchat/shared";

import { Button } from "./ui/button";

export function AuthView(props: {
  bridgePermission?: "denied" | "granted" | "prompt" | "unsupported";
  bridgeReachable: boolean;
  deviceAuth: AuthDeviceStartResponse | null;
  isConnecting: boolean;
  isGrantingBridgeAccess: boolean;
  requestBridgeAccess(): Promise<void>;
  startDeviceAuth(): Promise<void>;
  statusNote: string;
}) {
  if (!props.bridgeReachable) {
    if (props.bridgePermission === "prompt") {
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-2 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <LaptopMinimal className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Allow local bridge access</h2>
              <p className="text-sm text-muted-foreground">
                Chrome needs one permission before this hosted app can reach the local bridge.
              </p>
            </div>

            <Button className="w-full" onClick={() => void props.requestBridgeAccess()}>
              {props.isGrantingBridgeAccess ? "Checking bridge access..." : "Allow local bridge access"}
            </Button>

            <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
              <h3 className="text-sm font-medium">What happens next</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Click the button, then allow the browser prompt for local network or loopback access.
              </p>
            </div>

            {props.statusNote ? (
              <p className="text-sm text-center text-amber-600 dark:text-amber-400 font-medium">
                {props.statusNote}
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    if (props.bridgePermission === "denied") {
      return (
        <div className="flex h-full items-center justify-center px-6">
          <div className="w-full max-w-md space-y-8">
            <div className="space-y-2 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <LaptopMinimal className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Bridge access blocked</h2>
              <p className="text-sm text-muted-foreground">
                Allow local network access for this site in the browser, then retry.
              </p>
            </div>

            <Button className="w-full" onClick={() => void props.requestBridgeAccess()}>
              Retry bridge access
            </Button>

            {props.statusNote ? (
              <p className="text-sm text-center text-amber-600 dark:text-amber-400 font-medium">
                {props.statusNote}
              </p>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <LaptopMinimal className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Bridge offline</h2>
            <p className="text-sm text-muted-foreground">
              Start the local bridge on your machine to continue.
            </p>
          </div>

          <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
            <h3 className="text-sm font-medium">Expected local service</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The hosted app needs a local bridge for pairing, GitHub Copilot auth, model discovery,
              and streaming chat.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8">
        {props.deviceAuth ? (
          <>
            <div className="space-y-2 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <Link2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Finish GitHub Copilot sign-in</h2>
              <p className="text-sm text-muted-foreground">
                The bridge opened GitHub device sign-in. Enter this code if the browser page asks for it.
              </p>
            </div>

            <div className="rounded-2xl border bg-card px-6 py-5 text-center">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">User code</p>
              <p className="mt-3 text-3xl font-semibold tracking-[0.3em]">{props.deviceAuth.userCode}</p>
            </div>

            <Button asChild className="w-full">
              <a href={props.deviceAuth.verificationUri} rel="noreferrer" target="_blank">
                Open GitHub device page
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-2 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <Link2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Connect GitHub Copilot</h2>
              <p className="text-sm text-muted-foreground">
                Sign in through the local bridge. Provider credentials stay on your machine.
              </p>
            </div>

            <Button className="w-full" onClick={() => void props.startDeviceAuth()}>
              {props.isConnecting ? "Connecting..." : "Connect GitHub Copilot"}
            </Button>
          </>
        )}

        {props.statusNote ? (
          <p className="text-sm text-center text-amber-600 dark:text-amber-400 font-medium">
            {props.statusNote}
          </p>
        ) : null}

        <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
          <h3 className="text-sm font-medium">Security model</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Browser pairs with a local bridge. The bridge stores provider auth in secure local storage
            and performs chat inference without exposing the raw token to the web app.
          </p>
        </div>
      </div>
    </div>
  );
}
