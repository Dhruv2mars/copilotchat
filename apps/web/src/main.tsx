import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createAppStore } from "./app-store";
import { createBridgeClient } from "./bridge-client";
import { ThemeProvider } from "./components/theme-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false
    }
  }
});

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="dark">
    <QueryClientProvider client={queryClient}>
      <App
        client={createBridgeClient({
          baseUrl: import.meta.env.VITE_BRIDGE_BASE_URL ?? "http://127.0.0.1:8787"
        })}
        store={createAppStore()}
      />
    </QueryClientProvider>
  </ThemeProvider>
);
