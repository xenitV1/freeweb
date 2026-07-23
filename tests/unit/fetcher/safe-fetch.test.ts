import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  lookup: mockLookup,
}));

import {
  isPrivateIp,
  isHostResolvingToPrivate,
  validateFetchTarget,
  safeFetch,
} from "../../../src/fetcher/safe-fetch.js";

describe("isPrivateIp", () => {
  const privateIpv4 = [
    "127.0.0.1", "127.255.255.255", "10.0.0.1", "10.255.255.255",
    "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "100.127.255.255", "192.0.2.1",
    "224.0.0.1", "255.255.255.255",
  ];
  for (const ip of privateIpv4) {
    it(`blocks private/reserved IPv4 ${ip}`, () => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  }

  const publicIpv4 = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1"];
  for (const ip of publicIpv4) {
    it(`allows public IPv4 ${ip}`, () => {
      expect(isPrivateIp(ip)).toBe(false);
    });
  }

  it("blocks IPv6 loopback/unspecified", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
  });

  it("blocks IPv6 ULA (fc/fd)", () => {
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
  });

  it("blocks IPv6 link-local (fe80::/10)", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fea1::1")).toBe(true);
  });

  it("blocks IPv6 multicast (ff00::/8)", () => {
    expect(isPrivateIp("ff02::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 loopback", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.1.1")).toBe(true);
  });

  it("treats invalid input as private (fail closed)", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("999.999.999.999")).toBe(true);
  });
});

describe("isHostResolvingToPrivate", () => {
  beforeEach(() => mockLookup.mockReset());

  it("blocks known DNS-rebinding host localtest.me without lookup", async () => {
    await expect(isHostResolvingToPrivate("localtest.me")).resolves.toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks cloud metadata hostname", async () => {
    await expect(isHostResolvingToPrivate("metadata.google.internal")).resolves.toBe(true);
  });

  it("blocks wildcard-DNS hosts (*.nip.io / *.sslip.io) without lookup", async () => {
    await expect(isHostResolvingToPrivate("10.0.0.1.nip.io")).resolves.toBe(true);
    await expect(isHostResolvingToPrivate("192.168.1.1.sslip.io")).resolves.toBe(true);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks an IP literal directly", async () => {
    await expect(isHostResolvingToPrivate("169.254.169.254")).resolves.toBe(true);
  });

  it("fails closed when DNS returns no addresses", async () => {
    mockLookup.mockResolvedValue([]);
    await expect(isHostResolvingToPrivate("empty.example")).resolves.toBe(true);
  });

  it("allows a public hostname resolving to a public IP", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(isHostResolvingToPrivate("example.com")).resolves.toBe(false);
  });

  it("blocks a public-looking hostname that resolves to a private IP (DNS rebinding)", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(isHostResolvingToPrivate("attacker.com")).resolves.toBe(true);
  });
});

describe("validateFetchTarget", () => {
  beforeEach(() => mockLookup.mockReset());

  it("blocks IP literals before any DNS lookup", async () => {
    await expect(validateFetchTarget("http://127.0.0.1/")).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks localtest.me (DNS-rebinding loopback)", async () => {
    const r = await validateFetchTarget("http://localtest.me/");
    expect(r.ok).toBe(false);
  });

  it("allows a safe public URL resolving to a public IP", async () => {
    mockLookup.mockResolvedValue([{ address: "140.82.121.4", family: 4 }]);
    const r = await validateFetchTarget("https://github.com/");
    expect(r.ok).toBe(true);
  });
});

describe("safeFetch redirect SSRF guard", () => {
  beforeEach(() => mockLookup.mockReset());

  it("blocks an HTTP redirect chain whose target is an internal IP", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const fakeFetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fakeFetch);
    try {
      await expect(safeFetch("https://example.com/")).rejects.toThrow();
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns the response for a normal 200", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const fakeFetch = vi.fn(async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/html" } }),
    );
    vi.stubGlobal("fetch", fakeFetch);
    try {
      const res = await safeFetch("https://example.com/");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
