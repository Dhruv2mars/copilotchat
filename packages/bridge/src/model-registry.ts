export interface SourceModel {
  id: string;
  label: string;
  capabilities: string[];
  status: "available" | "maintenance" | "unavailable";
}

export interface BridgeModelSource {
  fetchModels(): Promise<SourceModel[]>;
}

export interface ListedModel {
  id: string;
  label: string;
}

export class ModelRegistry {
  private cache: { expiresAt: number; models: ListedModel[] } | null = null;

  constructor(
    private readonly options: {
      cacheTtlMs: number;
      now: () => number;
      source: BridgeModelSource;
    }
  ) {}

  async list(): Promise<ListedModel[]> {
    const now = this.options.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.models;
    }

    const models = (await this.options.source.fetchModels())
      .filter((model) => model.status === "available")
      .filter((model) => model.capabilities.includes("chat"))
      .map((model) => ({
        id: model.id,
        label: model.label
      }));

    this.cache = {
      expiresAt: now + this.options.cacheTtlMs,
      models
    };

    return models;
  }
}
