import { describe, it, expect } from "vitest";
import { isUrlSafe, checkDownloadRequest } from "../../src/lib.js";
import { buildLlmsCandidates } from "../../src/llms.js";

describe("IDN/Punycode attacks", () => {
  it("BUG: does not block punycode (IDN) domains — no IDN awareness", () => {
    expect(isUrlSafe("https://xn--nxasmq6b.com").safe).toBe(true);
    expect(isUrlSafe("https://www.xn--verisgn-0be.com").safe).toBe(true);
    expect(isUrlSafe("https://xn--phishing-xxx.com").safe).toBe(true);
  });

  it("blocks invalid malformed punycode that fails URL parsing", () => {
    expect(isUrlSafe("https://xn--g00gle-xxx.com").safe).toBe(false);
  });

  it("blocks punycode domains where blocked keyword is a standalone segment", () => {
    expect(isUrlSafe("https://xn--phishing.hack.com").safe).toBe(false);
    expect(isUrlSafe("https://hack.xn--nxasmq6b.com").safe).toBe(false);
  });
});

describe("URL encoding bypass", () => {
  it("blocks URL-encoded paths (URL parser decodes host)", () => {
    expect(isUrlSafe("https://example.com/%68%61%63%6b").safe).toBe(true);
  });

  it("security check operates on parsed URL not raw string", () => {
    expect(isUrlSafe("https://hack.com/%65%78%61%6d%70%6c%65").safe).toBe(false);
  });

  it("does not bypass blocked domain via percent-encoded host", () => {
    expect(isUrlSafe("https://%68%61%63%6b.com").safe).toBe(false);
  });
});

describe("Subdomain abuse", () => {
  it("blocks subdomains named after blocked keywords", () => {
    expect(isUrlSafe("https://hack.example.com").safe).toBe(false);
    expect(isUrlSafe("https://porn.google.com").safe).toBe(false);
    expect(isUrlSafe("https://spam.trusted.org").safe).toBe(false);
  });

  it("allows subdomains with blocked keywords as substrings", () => {
    expect(isUrlSafe("https://hackney.example.com").safe).toBe(true);
    expect(isUrlSafe("https://spammy.example.com").safe).toBe(true);
  });

  it("blocks when blocked keyword is the domain itself", () => {
    expect(isUrlSafe("https://example.hack.com").safe).toBe(false);
    expect(isUrlSafe("https://example.porn.com").safe).toBe(false);
    expect(isUrlSafe("https://example.scam.com").safe).toBe(false);
  });
});

describe("Path traversal in llms.txt candidate building", () => {
  it("never produces candidates outside the origin", () => {
    const candidates = buildLlmsCandidates("https://example.com/foo/bar/baz");
    for (const candidate of candidates) {
      const parsed = new URL(candidate);
      expect(parsed.hostname).toBe("example.com");
      expect(parsed.pathname).not.toContain("..");
      expect(parsed.pathname).not.toContain("/etc/");
      expect(parsed.pathname).not.toContain("passwd");
    }
  });

  it("handles URLs with unusual path segments", () => {
    const candidates = buildLlmsCandidates("https://example.com/a/b/c/d/e/f");
    for (const candidate of candidates) {
      expect(candidate).toMatch(/^https:\/\/example\.com\//);
    }
  });

  it("handles root URL correctly", () => {
    const candidates = buildLlmsCandidates("https://example.com/");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBe("https://example.com/llms.txt");
  });

  it("handles URL with file extension correctly", () => {
    const candidates = buildLlmsCandidates("https://example.com/docs/api.html");
    expect(candidates[0]).toBe("https://example.com/docs/llms.txt");
    expect(candidates[candidates.length - 1]).toBe("https://example.com/llms.txt");
  });
});

describe("SSRF via private IPs", () => {
  it("blocks RFC1918 private addresses (10.x.x.x)", () => {
    expect(isUrlSafe("http://10.0.0.1").safe).toBe(false);
    expect(isUrlSafe("http://10.255.255.255").safe).toBe(false);
  });

  it("blocks RFC1918 private addresses (192.168.x.x)", () => {
    expect(isUrlSafe("http://192.168.0.1").safe).toBe(false);
    expect(isUrlSafe("http://192.168.1.100").safe).toBe(false);
  });

  it("blocks loopback (127.0.0.1)", () => {
    expect(isUrlSafe("http://127.0.0.1").safe).toBe(false);
    expect(isUrlSafe("http://127.0.0.1:8080").safe).toBe(false);
  });

  it("blocks link-local (169.254.x.x)", () => {
    expect(isUrlSafe("http://169.254.169.254").safe).toBe(false);
  });

  it("blocks AWS metadata endpoint specifically", () => {
    expect(isUrlSafe("http://169.254.169.254/latest/meta-data/").safe).toBe(false);
  });
});

describe("Protocol confusion", () => {
  it("blocks javascript: protocol", () => {
    expect(isUrlSafe("javascript:alert(document.cookie)").safe).toBe(false);
    expect(isUrlSafe("JAVASCRIPT:alert(1)").safe).toBe(false);
  });

  it("blocks data: protocol", () => {
    expect(isUrlSafe("data:text/html,<script>alert(1)</script>").safe).toBe(false);
    expect(isUrlSafe("DATA:text/html;base64,PHNjcmlwdD4=").safe).toBe(false);
  });

  it("blocks vbscript: protocol", () => {
    expect(isUrlSafe("vbscript:MsgBox(1)").safe).toBe(false);
  });

  it("blocks file: protocol", () => {
    expect(isUrlSafe("file:///etc/passwd").safe).toBe(false);
    expect(isUrlSafe("file:///C:/Windows/System32/config/SAM").safe).toBe(false);
  });

  it("blocks ftp: protocol", () => {
    expect(isUrlSafe("ftp://example.com/file").safe).toBe(false);
  });

  it("only allows http: and https:", () => {
    expect(isUrlSafe("http://example.com").safe).toBe(true);
    expect(isUrlSafe("https://example.com").safe).toBe(true);
  });
});

describe("Port scanning prevention", () => {
  const blockedPorts = [
    { port: "21", name: "FTP" },
    { port: "22", name: "SSH" },
    { port: "25", name: "SMTP" },
    { port: "3306", name: "MySQL" },
    { port: "5432", name: "PostgreSQL" },
    { port: "6379", name: "Redis" },
    { port: "8443", name: "HTTPS alt" },
    { port: "9200", name: "Elasticsearch" },
    { port: "27017", name: "MongoDB" },
  ];

  for (const { port, name } of blockedPorts) {
    it(`blocks ${name} port ${port}`, () => {
      expect(isUrlSafe(`http://example.com:${port}`).safe).toBe(false);
    });
  }

  const allowedPorts = ["80", "443", "8080", "3000", "5000"];
  for (const port of allowedPorts) {
    it(`allows port ${port}`, () => {
      expect(isUrlSafe(`http://example.com:${port}`).safe).toBe(true);
    });
  }
});

describe("Missing download extensions", () => {
  it("BUG: does not block .pdf downloads", () => {
    expect(checkDownloadRequest("https://example.com/manual.pdf").allowed).toBe(true);
  });

  it("BUG: does not block .doc/.docx downloads", () => {
    expect(checkDownloadRequest("https://example.com/document.doc").allowed).toBe(true);
    expect(checkDownloadRequest("https://example.com/document.docx").allowed).toBe(true);
  });

  it("BUG: does not block .xls/.xlsx downloads", () => {
    expect(checkDownloadRequest("https://example.com/spreadsheet.xls").allowed).toBe(true);
    expect(checkDownloadRequest("https://example.com/spreadsheet.xlsx").allowed).toBe(true);
  });

  it("BUG: does not block .ppt downloads", () => {
    expect(checkDownloadRequest("https://example.com/presentation.ppt").allowed).toBe(true);
  });

  it("BUG: does not block .odt downloads", () => {
    expect(checkDownloadRequest("https://example.com/document.odt").allowed).toBe(true);
  });

  it("blocks known download extensions", () => {
    expect(checkDownloadRequest("https://example.com/file.zip").allowed).toBe(false);
    expect(checkDownloadRequest("https://example.com/file.exe").allowed).toBe(false);
    expect(checkDownloadRequest("https://example.com/file.dmg").allowed).toBe(false);
  });
});

describe("Homograph domains", () => {
  it("BUG: allows g00gle.com (numeral substitution)", () => {
    expect(isUrlSafe("https://g00gle.com").safe).toBe(true);
  });

  it("BUG: allows paypa1.com (numeral substitution)", () => {
    expect(isUrlSafe("https://paypa1.com").safe).toBe(true);
  });

  it("BUG: allows micros0ft.com (numeral substitution)", () => {
    expect(isUrlSafe("https://micros0ft.com").safe).toBe(true);
  });

  it("blocks exact blocked keyword matches in segments", () => {
    expect(isUrlSafe("https://hack.com").safe).toBe(false);
    expect(isUrlSafe("https://scam.com").safe).toBe(false);
  });
});

describe("Localhost variants", () => {
  it("BUG: allows http://localhost (not an IP, not blocked)", () => {
    expect(isUrlSafe("http://localhost").safe).toBe(true);
  });

  it("BUG: allows http://localhost:3000", () => {
    expect(isUrlSafe("http://localhost:3000").safe).toBe(true);
  });

  it("blocks http://127.0.0.1 (IP address check)", () => {
    expect(isUrlSafe("http://127.0.0.1").safe).toBe(false);
  });

  it("blocks http://0.0.0.0 (IP address check)", () => {
    expect(isUrlSafe("http://0.0.0.0").safe).toBe(false);
  });

  it("BUG: allows http://[::1] (IPv6 loopback not checked)", () => {
    expect(isUrlSafe("http://[::1]").safe).toBe(true);
  });

  it("BUG: allows http://[::1]:8080 (IPv6 loopback with port)", () => {
    expect(isUrlSafe("http://[::1]:8080").safe).toBe(true);
  });
});

describe("Segment-based domain matching (fix verification)", () => {
  it("hackney.gov.uk is safe (hack is a substring of hackney, not a segment)", () => {
    expect(isUrlSafe("https://hackney.gov.uk").safe).toBe(true);
  });

  it("adultlearning.edu is safe (adult is a substring of adultlearning, not a segment)", () => {
    expect(isUrlSafe("https://adultlearning.edu").safe).toBe(true);
  });

  it("scampbell.com is safe (scam is a substring of scampbell, not a segment)", () => {
    expect(isUrlSafe("https://scampbell.com").safe).toBe(true);
  });

  it("hack.com is blocked (hack is a full segment)", () => {
    expect(isUrlSafe("https://hack.com").safe).toBe(false);
  });

  it("sub.hack.com is blocked (hack is a full segment)", () => {
    expect(isUrlSafe("https://sub.hack.com").safe).toBe(false);
  });

  it("xxx.com is blocked (xxx is a full segment)", () => {
    expect(isUrlSafe("https://xxx.com").safe).toBe(false);
  });

  it("xxxxx.com is safe (xxx is a substring of xxxxx, not a segment)", () => {
    expect(isUrlSafe("https://xxxxx.com").safe).toBe(true);
  });
});
