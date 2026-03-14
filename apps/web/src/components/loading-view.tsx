import { Loader2 } from "lucide-react";

export function LoadingView() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Loading session</h2>
        <p className="text-sm text-muted-foreground">
          Checking your hosted GitHub session and loading the model catalog.
        </p>
      </div>
    </div>
  );
}
