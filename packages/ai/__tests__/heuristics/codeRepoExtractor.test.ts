import { extractCodeRepos } from "../../src/heuristics/codeRepoExtractor";

describe("extractCodeRepos", () => {
  it("extracts GitHub URLs and tags status as unknown", () => {
    const text = "Code at https://github.com/openai/baselines and https://github.com/openai/baselines.";
    const repos = extractCodeRepos(text);
    expect(repos).toHaveLength(1);
    expect(repos[0]!.provider).toBe("github");
    expect(repos[0]!.status).toBe("unknown");
  });

  it("normalises trailing punctuation", () => {
    const repos = extractCodeRepos("see https://github.com/user/proj.");
    expect(repos[0]!.url).toBe("https://github.com/user/proj");
  });

  it("supports GitLab", () => {
    const repos = extractCodeRepos("https://gitlab.com/foo/bar");
    expect(repos[0]!.provider).toBe("gitlab");
  });
});
