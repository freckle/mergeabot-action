import { describe, expect, it } from "vitest";

import { createGithubClient } from "./githubClient.js";

type Call = {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWithFetch(
  handler: (call: Call) => Response | Promise<Response>,
): { client: ReturnType<typeof createGithubClient>; calls: Call[] } {
  const calls: Call[] = [];

  const fetch = async (
    url: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  };

  const client = createGithubClient("token", "owner", "repo", {
    request: { fetch },
  });

  return { client, calls };
}

describe("createGithubClient / searchQuarantinedPrs", () => {
  it("paginates and maps GraphQL search results", async () => {
    const { client, calls } = clientWithFetch((call) => {
      const after = call.body?.variables as { after: string | null };
      if (after.after === null) {
        return jsonResponse({
          data: {
            search: {
              nodes: [
                {
                  id: "PR_1",
                  number: 1,
                  title: "Bump foo",
                  createdAt: "2024-01-01T00:00:00Z",
                  reviewDecision: "APPROVED",
                },
              ],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          search: {
            nodes: [
              {
                id: "PR_2",
                number: 2,
                title: "Bump bar",
                createdAt: "2024-01-02T00:00:00Z",
                reviewDecision: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    });

    const prs = await client.searchQuarantinedPrs("author:app/dependabot");

    expect(prs).toEqual([
      {
        id: "PR_1",
        number: 1,
        title: "Bump foo",
        createdAt: "2024-01-01T00:00:00Z",
        reviewDecision: "APPROVED",
      },
      {
        id: "PR_2",
        number: 2,
        title: "Bump bar",
        createdAt: "2024-01-02T00:00:00Z",
        reviewDecision: null,
      },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1].body?.variables).toEqual({
      searchQuery: "author:app/dependabot",
      after: "cursor-1",
    });
  });

  it("stops paginating once 1000 results have been collected", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: `PR_${i}`,
      number: i,
      title: "Bump foo",
      createdAt: "2024-01-01T00:00:00Z",
      reviewDecision: null,
    }));

    const { client, calls } = clientWithFetch(() =>
      jsonResponse({
        data: {
          search: {
            nodes: page,
            pageInfo: { hasNextPage: true, endCursor: "next" },
          },
        },
      }),
    );

    const prs = await client.searchQuarantinedPrs("author:app/dependabot");

    expect(prs).toHaveLength(1000);
    expect(calls).toHaveLength(10);
  });
});

describe("createGithubClient / enableAutoMerge", () => {
  it.each([
    ["merge", "MERGE"],
    ["rebase", "REBASE"],
    ["squash", "SQUASH"],
  ] as const)(
    "maps strategy %s to merge method %s",
    async (strategy, mergeMethod) => {
      const { client, calls } = clientWithFetch(() =>
        jsonResponse({
          data: { enablePullRequestAutoMerge: { clientMutationId: null } },
        }),
      );

      await client.enableAutoMerge("PR_id", strategy);

      expect(calls[0].body?.variables).toEqual({
        pullRequestId: "PR_id",
        mergeMethod,
      });
    },
  );
});

describe("createGithubClient / REST-backed methods", () => {
  it("maps requested reviewers by login and team slug", async () => {
    const { client } = clientWithFetch(() =>
      jsonResponse({
        users: [{ login: "alice" }],
        teams: [{ slug: "team-a" }],
      }),
    );

    expect(await client.listRequestedReviewers(1)).toEqual({
      users: ["alice"],
      teams: ["team-a"],
    });
  });

  it("paginates listPrFiles by filename", async () => {
    const { client, calls } = clientWithFetch((call) => {
      const linkedFirstPage = !call.url.includes("page=2");
      const headers = linkedFirstPage
        ? {
            link: '<https://api.github.com/repos/owner/repo/pulls/1/files?page=2>; rel="next"',
          }
        : {};
      const body = linkedFirstPage
        ? [{ filename: "a.json" }]
        : [{ filename: "b.json" }];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      });
    });

    const files = await client.listPrFiles(1);

    expect(files).toEqual(["a.json", "b.json"]);
    expect(calls).toHaveLength(2);
  });

  it("approves a PR via a review event", async () => {
    const { client, calls } = clientWithFetch(() => jsonResponse({}));

    await client.approve(42);

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: expect.stringContaining("/pulls/42/reviews"),
      body: { event: "APPROVE" },
    });
  });

  it("removes requested reviewers by login and team slug", async () => {
    const { client, calls } = clientWithFetch(() => jsonResponse({}));

    await client.removeRequestedReviewers(1, ["alice"], ["team-a"]);

    expect(calls[0]).toMatchObject({
      method: "DELETE",
      body: { reviewers: ["alice"], team_reviewers: ["team-a"] },
    });
  });

  it("creates a comment with the given body", async () => {
    const { client, calls } = clientWithFetch(() => jsonResponse({}));

    await client.createComment(1, "hello");

    expect(calls[0]).toMatchObject({
      method: "POST",
      url: expect.stringContaining("/issues/1/comments"),
      body: { body: "hello" },
    });
  });
});
