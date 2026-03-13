export const BRIDGE_PROTOCOL_VERSION = "2026-03-13";

export interface BridgeHealth {
  auth: AuthSessionResponse;
  bridgeVersion: string;
  protocolVersion: string;
  status: "ok";
}

export interface PairStartRequest {
  origin: string;
}

export interface PairStartResponse {
  code: string;
  expiresAt: string;
  origin: string;
  pairingId: string;
}

export interface PairConfirmRequest {
  code: string;
  origin: string;
  pairingId: string;
}

export interface PairConfirmResponse {
  pairedAt: string;
  token: string;
}

export interface AuthDeviceStartRequest {
  organization?: string;
  openInBrowser?: boolean;
}

export interface AuthDeviceStartResponse {
  deviceCode: string;
  expiresAt: string;
  intervalSeconds: number;
  organization?: string;
  userCode: string;
  verificationUri: string;
}

export interface AuthDevicePollRequest {
  deviceCode: string;
}

export interface AuthSessionResponse {
  accountLabel: string | null;
  authenticated: boolean;
  expiresAt?: string;
  organization?: string;
  provider: "github-models";
  tokenHint?: string;
}

export interface AuthDevicePollResponse extends AuthSessionResponse {
  pollAfterSeconds?: number;
  status: "complete" | "pending";
}

export interface ListedModel {
  id: string;
  label: string;
}

export interface ChatMessage {
  content: string;
  id: string;
  role: "assistant" | "system" | "user";
}

export interface ChatStreamRequest {
  messages: ChatMessage[];
  modelId: string;
  requestId: string;
}

export interface AssistantDeltaEvent {
  data: string;
  type: "assistant_delta";
}

export interface AssistantDoneEvent {
  type: "assistant_done";
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AssistantErrorEvent {
  message: string;
  type: "assistant_error";
}

export type BridgeStreamEvent =
  | AssistantDeltaEvent
  | AssistantDoneEvent
  | AssistantErrorEvent;
