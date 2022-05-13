import { Octokit } from "octokit";
import { Gauge } from "prom-client";

// What do we want to know
// # of open issues
//   -- by label
// # of closed issues in the last N days

interface CurrentIssue {
	id: string;
	labels: string[];
	author: string;
	createdAt: Date;
	updatedAt: Date;
}

interface FetchIssuesResponse {
	repository: {
		issues: {
			edges: {
				node: {
					id: string;
					author: {
						login: string;
					},
					updatedAt: string;
					createdAt: string;
					labels: {
						edges: {
							node: {
								name: string;
							}
						}[]
					}
				}
			}[],
			pageInfo: {
              hasNextPage: boolean,
              endCursor: string,
			},
		}
	}
}

const openIssuesGauge = new Gauge({
    labelNames: ["label", "isCommunity", "repository"],
    name: "github_open_issues",
    help: "The number of open issues tracked against labels."
});

const closedIssuesGauge = new Gauge({
    labelNames: ["label", "isCommunity", "repository"],
    name: "github_closed_issues",
    help: "The number of closed issues tracked against labels over the last 7 days."
});

const unlabelledIssuesGauge = new Gauge({
    labelNames: ["repository"],
    name: "github_unlabelled_issues",
    help: "The number of issues with no labels."
});


export class RepoWatcher {
	constructor(
		private readonly octokit: Octokit,
		private readonly owner: string,
		private readonly repo: string,
		private readonly labels: string[],
		private readonly filterTeamMembers: string[]
	) {
	}

	public async fetchIssues(state: "OPEN"|"CLOSED", since?: Date): Promise<CurrentIssue[]> {
		const issues: CurrentIssue[] = [];
		let res: FetchIssuesResponse|undefined = undefined;
		const dateStr = since ? `, filterBy: {since: "${since.toISOString()}"}` : "";
		do {
			res = await this.octokit.graphql(`
			query fetchOpenIssues($name: String!, $owner: String!, $after: String) {
				repository(name: $name, owner: $owner) {
				  issues(first: 100, states: ${state}, after: $after${dateStr}) {
					pageInfo {
					  hasNextPage
					  endCursor
					}
					edges {
					  node {
						id
						labels(first: 10) {
						  edges {
							node {
							  name
							}
						  }
						}
						author {
						  login
						}
						updatedAt
						createdAt
					  }
					}
				  }
				}
			  }`, {
				owner: this.owner,
				name: this.repo,
				after: res?.repository.issues.pageInfo.endCursor,
			}) as FetchIssuesResponse;
			issues.push(...res.repository.issues.edges.map(issue => ({
				id: issue.node.id,
				author: issue.node.author.login,
				labels: issue.node.labels.edges.map(l => l.node.name),
				createdAt: new Date(issue.node.createdAt),
				updatedAt: new Date(issue.node.updatedAt),
			} as CurrentIssue)));
		} while (res.repository.issues.pageInfo.hasNextPage)
		return issues;
	}

	public async refreshMetrics() {
		// Fetch existing data
		const openIssues = await this.fetchIssues("OPEN");
        const repository = `${this.owner}/${this.repo}`;
		for (const label of this.labels) {
			const allIssues = openIssues.filter(i => i.labels.includes(label));
			const ownTeam = allIssues.filter(i => this.filterTeamMembers.includes(i.author)).length;
			openIssuesGauge.set({
				isCommunity: "false",
				repository: `${this.owner}/${this.repo}`,
				label,
			}, ownTeam);
            if (this.filterTeamMembers.length) {
                openIssuesGauge.set({
                    isCommunity: "true",
                    repository,
                    label,
                }, allIssues.length - ownTeam);
            }
		}

        unlabelledIssuesGauge.set(
            {repository},
            openIssues.filter(i => i.labels.length === 0).length
        );
		
		// 7 days ago
		const closedIssues = await this.fetchIssues("CLOSED", new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)));
		
		for (const label of this.labels) {
			const allIssues = closedIssues.filter(i => i.labels.includes(label));
			const ownTeam = allIssues.filter(i => this.filterTeamMembers.includes(i.author)).length;
			closedIssuesGauge.set({
				isCommunity: "false",
				repository: `${this.owner}/${this.repo}`,
				label,
			}, ownTeam);
            if (this.filterTeamMembers.length) {
                closedIssuesGauge.set({
                    isCommunity: "true",
                    repository: `${this.owner}/${this.repo}`,
                    label,
                }, allIssues.length - ownTeam);
            }
		}
	}
}