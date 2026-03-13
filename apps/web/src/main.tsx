import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createAppStore } from "./app-store";
import { createHttpBridgeClient } from "./bridge-client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App
      client={createHttpBridgeClient({
        baseUrl: "http://127.0.0.1:8787"
      })}
      store={createAppStore()}
    />
  </QueryClientProvider>
);
