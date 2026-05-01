import { describe, it, expect } from "vitest";
import { tagExternalContent, CONTENT_SAFETY_NOTICE } from "../../src/lib.js";

describe("CONTENT_SAFETY_NOTICE", () => {
  it("is a non-empty string", () => {
    expect(typeof CONTENT_SAFETY_NOTICE).toBe("string");
    expect(CONTENT_SAFETY_NOTICE.length).toBeGreaterThan(50);
  });

  it("contains key warning phrases", () => {
    expect(CONTENT_SAFETY_NOTICE).toContain("EXTERNAL CONTENT");
    expect(CONTENT_SAFETY_NOTICE).toContain("DATA");
    expect(CONTENT_SAFETY_NOTICE).toContain("instructions");
  });

  it("mentions common injection patterns", () => {
    expect(CONTENT_SAFETY_NOTICE).toContain("ignore previous instructions");
    expect(CONTENT_SAFETY_NOTICE).toContain("system:");
    expect(CONTENT_SAFETY_NOTICE).toContain("act as");
  });
});

describe("tagExternalContent", () => {
  it("wraps content in external-content XML tags", () => {
    const result = tagExternalContent("Hello world");
    expect(result).toContain("<external-content>");
    expect(result).toContain("</external-content>");
    expect(result).toContain("Hello world");
  });

  it("prepends the safety notice before the tags", () => {
    const result = tagExternalContent("test");
    const noticeIndex = result.indexOf(CONTENT_SAFETY_NOTICE);
    const tagIndex = result.indexOf("<external-content>");
    expect(noticeIndex).toBeLessThan(tagIndex);
  });

  it("places content between opening and closing tags", () => {
    const content = "Some web page content here";
    const result = tagExternalContent(content);
    const openIdx = result.indexOf("<external-content>");
    const closeIdx = result.indexOf("</external-content>");
    const contentIdx = result.indexOf(content);
    expect(contentIdx).toBeGreaterThan(openIdx);
    expect(contentIdx).toBeLessThan(closeIdx);
  });

  it("handles empty string", () => {
    const result = tagExternalContent("");
    expect(result).toContain("<external-content>");
    expect(result).toContain("</external-content>");
  });

  it("handles content with XML-like characters", () => {
    const content = '<div class="test">value & "quoted"</div>';
    const result = tagExternalContent(content);
    expect(result).toContain(content);
  });

  it("handles multiline content", () => {
    const content = "line1\nline2\nline3";
    const result = tagExternalContent(content);
    expect(result).toContain("line1\nline2\nline3");
  });

  it("is idempotent in structure — wrapping twice produces valid nested output", () => {
    const first = tagExternalContent("test");
    const second = tagExternalContent(first);
    expect(second).toContain("<external-content>");
    expect(second.match(/<external-content>/g)).toHaveLength(2);
  });

  it("preserves content exactly without modification", () => {
    const content = "Hello 🌍 \n\t <script>alert('xss')</script> \r\n end";
    const result = tagExternalContent(content);
    const extracted = result.slice(
      result.indexOf("<external-content>\n") + "<external-content>\n".length,
      result.indexOf("\n</external-content>"),
    );
    expect(extracted).toBe(content);
  });

  it("includes full notice text in output", () => {
    const result = tagExternalContent("test");
    expect(result).toContain(CONTENT_SAFETY_NOTICE);
  });
});
