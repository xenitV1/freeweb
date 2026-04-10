import { describe, it, expect } from "vitest";
import { isUrlSafe, checkDownloadRequest } from "../../src/lib.js";

describe("isUrlSafe", () => {
  it("allows valid HTTPS URLs", () => {
    expect(isUrlSafe("https://example.com")).toEqual({ safe: true });
    expect(isUrlSafe("https://github.com/owner/repo")).toEqual({ safe: true });
  });

  it("allows valid HTTP URLs", () => {
    expect(isUrlSafe("http://example.com")).toEqual({ safe: true });
  });

  it("blocks non-HTTP protocols", () => {
    expect(isUrlSafe("ftp://example.com").safe).toBe(false);
    expect(isUrlSafe("javascript:alert(1)").safe).toBe(false);
    expect(isUrlSafe("file:///etc/passwd").safe).toBe(false);
    expect(isUrlSafe("data:text/html,<h1>test</h1>").safe).toBe(false);
  });

  it("blocks domains with blocked keywords as exact segments", () => {
    const blockedKeywords = ["malware", "phishing", "spam", "scam", "hack", "crack", "warez", "pirate", "porn", "xxx", "adult", "sex"];
    for (const kw of blockedKeywords) {
      expect(isUrlSafe(`https://${kw}.com`).safe).toBe(false);
      expect(isUrlSafe(`https://${kw}.com`).reason).toBe("Blocked domain");
      expect(isUrlSafe(`https://www.${kw}.com`).safe).toBe(false);
    }
  });

  it("does not false-positive on substring matches in longer segments (fix verified)", () => {
    expect(isUrlSafe("https://www.hackney.gov.uk").safe).toBe(true);
    expect(isUrlSafe("https://adultlearning.edu").safe).toBe(true);
    expect(isUrlSafe("https://scampbell.com").safe).toBe(true);
  });

  it("blocks IP addresses", () => {
    expect(isUrlSafe("http://192.168.1.1").safe).toBe(false);
    expect(isUrlSafe("http://10.0.0.1").safe).toBe(false);
    expect(isUrlSafe("http://127.0.0.1").safe).toBe(false);
    expect(isUrlSafe("http://8.8.8.8").safe).toBe(false);
  });

  it("blocks suspicious ports", () => {
    expect(isUrlSafe("http://example.com:1234").safe).toBe(false);
    expect(isUrlSafe("http://example.com:6666").safe).toBe(false);
    expect(isUrlSafe("http://example.com:22").safe).toBe(false);
  });

  it("allows standard ports", () => {
    expect(isUrlSafe("http://example.com:80").safe).toBe(true);
    expect(isUrlSafe("https://example.com:443").safe).toBe(true);
    expect(isUrlSafe("http://example.com:8080").safe).toBe(true);
    expect(isUrlSafe("http://example.com:3000").safe).toBe(true);
    expect(isUrlSafe("http://example.com:5000").safe).toBe(true);
  });

  it("returns Invalid URL for malformed URLs", () => {
    expect(isUrlSafe("not-a-url").safe).toBe(false);
    expect(isUrlSafe("").safe).toBe(false);
    expect(isUrlSafe("://missing-scheme").safe).toBe(false);
  });

  it("does not false-positive on unrelated substring matches", () => {
    expect(isUrlSafe("https://seychelles.travel").safe).toBe(true);
    expect(isUrlSafe("https://mccampbell.com").safe).toBe(true);
  });

  it("blocks localhost hostname (SSRF prevention)", () => {
    expect(isUrlSafe("http://localhost").safe).toBe(false);
    expect(isUrlSafe("http://localhost:3000").safe).toBe(false);
  });

  it("allows homograph-similar domains (no visual similarity check)", () => {
    expect(isUrlSafe("https://g00gle.com").safe).toBe(true);
    expect(isUrlSafe("https://paypa1.com").safe).toBe(true);
  });
});

describe("checkDownloadRequest", () => {
  it("allows normal pages", () => {
    expect(checkDownloadRequest("https://example.com/page").allowed).toBe(true);
    expect(checkDownloadRequest("https://github.com/owner/repo").allowed).toBe(true);
  });

  it("blocks download paths", () => {
    expect(checkDownloadRequest("https://example.com/download/file").allowed).toBe(false);
    expect(checkDownloadRequest("https://github.com/owner/repo/releases/download/v1.0/app.zip").allowed).toBe(false);
  });

  it("blocks download extensions", () => {
    const extensions = [".zip", ".exe", ".dmg", ".pkg", ".msi", ".apk", ".tar", ".gz", ".rar", ".7z", ".bin", ".iso"];
    for (const ext of extensions) {
      expect(checkDownloadRequest(`https://example.com/file${ext}`).allowed).toBe(false);
    }
  });

  it("allows files that are not download types", () => {
    expect(checkDownloadRequest("https://example.com/page.html").allowed).toBe(true);
    expect(checkDownloadRequest("https://example.com/data.json").allowed).toBe(true);
    expect(checkDownloadRequest("https://example.com/style.css").allowed).toBe(true);
    expect(checkDownloadRequest("https://example.com/image.png").allowed).toBe(true);
  });

  it("blocks .pdf downloads", () => {
    expect(checkDownloadRequest("https://example.com/manual.pdf").allowed).toBe(false);
  });

  it("blocks .doc/.docx downloads", () => {
    expect(checkDownloadRequest("https://example.com/document.doc").allowed).toBe(false);
    expect(checkDownloadRequest("https://example.com/document.docx").allowed).toBe(false);
  });
});
