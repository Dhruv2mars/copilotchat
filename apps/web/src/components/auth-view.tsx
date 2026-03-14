import { KeyRound, Terminal } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function AuthView(props: {
  devCliAvailable: boolean;
  personalAccessToken: string;
  setPersonalAccessToken(value: string): void;
  startPatAuth(): Promise<void>;
  startLocalCliAuth(): Promise<void>;
  statusNote: string;
}) {
  return (
    <div className="flex items-center justify-center h-full px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted mx-auto mb-4">
            <KeyRound className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Connect a PAT with Models access
          </h2>
          <p className="text-sm text-muted-foreground">
            Use a GitHub personal access token with GitHub Models permission. Device-flow tokens do not reliably work here.
          </p>
        </div>

        {props.statusNote ? (
          <p className="text-sm text-center text-amber-600 dark:text-amber-400 font-medium">
            {props.statusNote}
          </p>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="pat-input">
              Personal access token
            </label>
            <Input
              id="pat-input"
              aria-label="Personal access token"
              autoComplete="off"
              onChange={(event) => props.setPersonalAccessToken(event.target.value)}
              placeholder="github_pat_..."
              type="password"
              value={props.personalAccessToken}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Button onClick={() => void props.startPatAuth()}>
              Connect PAT
            </Button>
            {props.devCliAvailable ? (
              <Button
                variant="outline"
                onClick={() => void props.startLocalCliAuth()}
              >
                <Terminal className="mr-2 h-4 w-4" />
                Use local GitHub CLI
              </Button>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
          <h3 className="text-sm font-medium">Required token</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            GitHub PAT with Models access. The BFF stores it in an encrypted http-only session cookie after validation.
          </p>
        </div>
      </div>
    </div>
  );
}
