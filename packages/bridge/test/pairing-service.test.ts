import { describe, expect, it } from "vitest";

import {
  PairingService,
  type PairingClock
} from "../src/pairing-service";

describe("PairingService", () => {
  const origin = "https://copilotchat.vercel.app";
  let now = new Date("2026-03-13T10:00:00.000Z");
  const clock: PairingClock = {
    now: () => now
  };

  it("issues short-lived challenges and validates confirmed tokens", () => {
    now = new Date("2026-03-13T10:00:00.000Z");
    const service = new PairingService({
      allowedOrigins: [origin],
      challengeTtlMs: 60_000,
      tokenTtlMs: 300_000,
      clock
    });

    const challenge = service.start({
      origin
    });

    expect(challenge.origin).toBe(origin);
    expect(challenge.expiresAt).toBe("2026-03-13T10:01:00.000Z");
    expect(challenge.code).toMatch(/^[A-Z0-9]{6}$/);

    const session = service.confirm({
      pairingId: challenge.pairingId,
      code: challenge.code,
      origin
    });

    expect(session.pairedAt).toBe(now.toISOString());
    expect(service.validate({
      token: session.token,
      origin
    })).toBe(true);
    expect(service.validate({
      token: session.token,
      origin: "https://evil.example"
    })).toBe(false);
  });

  it("rejects untrusted origins and bad confirmation codes", () => {
    now = new Date("2026-03-13T10:00:00.000Z");
    const service = new PairingService({
      allowedOrigins: [origin],
      challengeTtlMs: 60_000,
      tokenTtlMs: 300_000,
      clock
    });

    expect(() =>
      service.start({
        origin: "https://evil.example"
      })
    ).toThrow("origin_not_allowed");

    const challenge = service.start({
      origin
    });

    expect(() =>
      service.confirm({
        pairingId: challenge.pairingId,
        code: "ZZZZZZ",
        origin
      })
    ).toThrow("pairing_code_invalid");
  });

  it("rejects expired or missing pairings and expires tokens", () => {
    now = new Date("2026-03-13T10:00:00.000Z");
    const service = new PairingService({
      allowedOrigins: [origin],
      challengeTtlMs: 60_000,
      tokenTtlMs: 300_000,
      clock
    });

    const challenge = service.start({
      origin
    });

    now = new Date("2026-03-13T10:02:00.000Z");

    expect(() =>
      service.confirm({
        pairingId: challenge.pairingId,
        code: challenge.code,
        origin
      })
    ).toThrow("pairing_not_found");

    expect(() =>
      service.confirm({
        pairingId: "missing",
        code: "ABC123",
        origin
      })
    ).toThrow("pairing_not_found");

    now = new Date("2026-03-13T10:03:00.000Z");

    const freshChallenge = service.start({
      origin
    });
    const session = service.confirm({
      pairingId: freshChallenge.pairingId,
      code: freshChallenge.code,
      origin
    });

    now = new Date("2026-03-13T10:09:00.000Z");

    expect(service.validate({
      token: session.token,
      origin
    })).toBe(false);
    expect(service.validate({
      token: "missing",
      origin
    })).toBe(false);
  });
});
