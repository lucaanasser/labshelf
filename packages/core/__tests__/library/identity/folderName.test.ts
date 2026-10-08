import { FOLDER_NAME_MAX_LENGTH, validateFolderName } from "@labshelf/core";

describe("validateFolderName", () => {
  it.each([
    ["", "The name cannot be empty."],
    ["   ", "The name cannot be empty."],
    ["a/b", "Use a name without slashes."],
    ["a\\b", "Use a name without slashes."],
    [".", "A collection name cannot start with a dot."],
    ["..", "A collection name cannot start with a dot."],
    [".hidden", "A collection name cannot start with a dot."],
    ["  .hidden", "A collection name cannot start with a dot."],
    ["bad\u0001name", "The name contains control characters."],
    ["bad\u007fname", "The name contains control characters."],
  ])("rejects %j", (name, message) => {
    expect(validateFolderName(name)).toBe(message);
  });

  it.each(["Machine Learning", "Café", "v1.2", "日本語", "  padded  ", "a-b_c"])("accepts %j", (name) => {
    expect(validateFolderName(name)).toBeUndefined();
  });

  it("accepts 255 characters and rejects 256", () => {
    expect(FOLDER_NAME_MAX_LENGTH).toBe(255);
    expect(validateFolderName("a".repeat(255))).toBeUndefined();
    expect(validateFolderName("a".repeat(256))).toBe("The name is too long (at most 255 characters).");
  });

  it("measures the trimmed name", () => {
    expect(validateFolderName(` ${"a".repeat(255)} `)).toBeUndefined();
  });
});
