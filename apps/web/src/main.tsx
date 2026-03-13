import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createAppStore } from "./app-store";
import { createHttpBffClient } from "./bff-client";

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
      client={createHttpBffClient({
        baseUrl: import.meta.env.VITE_API_BASE_URL ?? "/api"
      })}
      store={createAppStore()}
    />
  </QueryClientProvider>
);
