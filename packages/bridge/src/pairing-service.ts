import { createHash, randomBytes, randomUUID } from "node:crypto";

export interface PairingClock {
  now(): Date;
}

interface PairingChallengeRecord {
  code: string;
  expiresAt: number;
  origin: string;
}

interface PairingTokenRecord {
  expiresAt: number;
  origin: string;
}

export interface PairingChallenge {
  code: string;
  expiresAt: string;
  origin: string;
  pairingId: string;
}

export interface PairingSession {
  pairedAt: string;
  token: string;
}

export class PairingService {
  private readonly challenges = new Map<string, PairingChallengeRecord>();
  private readonly tokens = new Map<string, PairingTokenRecord>();

  constructor(
    private readonly options: {
      allowedOrigins: string[];
      challengeTtlMs: number;
      tokenTtlMs: number;
      clock: PairingClock;
    }
  ) {}

  start(input: { origin: string }): PairingChallenge {
    this.assertAllowedOrigin(input.origin);

    const issuedAt = this.options.clock.now();
    const pairingId = randomUUID();
    const code = this.generateCode();
    const expiresAt = issuedAt.getTime() + this.options.challengeTtlMs;

    this.challenges.set(pairingId, {
      code,
      expiresAt,
      origin: input.origin
    });

    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      origin: input.origin,
      pairingId
    };
  }

  confirm(input: { pairingId: string; code: string; origin: string }): PairingSession {
    this.assertAllowedOrigin(input.origin);
    const challenge = this.challenges.get(input.pairingId);
    const now = this.options.clock.now();

    if (!challenge || challenge.origin !== input.origin || challenge.expiresAt <= now.getTime()) {
      throw new Error("pairing_not_found");
    }

    if (challenge.code !== input.code) {
      throw new Error("pairing_code_invalid");
    }

    this.challenges.delete(input.pairingId);

    const token = createHash("sha256")
      .update(`${input.pairingId}:${input.origin}:${now.toISOString()}`)
      .digest("hex");

    this.tokens.set(token, {
      expiresAt: now.getTime() + this.options.tokenTtlMs,
      origin: input.origin
    });

    return {
      pairedAt: now.toISOString(),
      token
    };
  }

  validate(input: { token: string; origin: string }): boolean {
    if (!this.options.allowedOrigins.includes(input.origin)) {
      return false;
    }

    const record = this.tokens.get(input.token);
    if (!record) {
      return false;
    }

    return record.origin === input.origin && record.expiresAt > this.options.clock.now().getTime();
  }

  private assertAllowedOrigin(origin: string) {
    if (!this.options.allowedOrigins.includes(origin)) {
      throw new Error("origin_not_allowed");
    }
  }

  private generateCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
  }
}
