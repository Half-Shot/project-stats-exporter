import { Octokit } from "octokit";
import { Gauge, Histogram } from "prom-client";

interface CurrentIssue {
	id: string;
	labels: Set<string>;
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

const DAY_MS = 24 * 60 * 60 * 1000;

const openIssuesDaysGauge = new Histogram({
    labelNames: ["label", "repository", "community"],
    name: "github_open_issues",
    help: "The number of open issues tracked against labels. This is tracked in number of open days.",
	buckets: [
		1,
		7,
		14,
		28,
		28 * 3,
	]
});


const closedIssuesGauge = new Gauge({
    labelNames: ["label", "isCommunity", "repository"],
    name: "github_closed_issues",
    help: "The number of closed issues tracked against labels over the last 7 days."
});

const unlabeledIssuesGauge = new Gauge({
    labelNames: ["repository"],
    name: "github_unlabeled_issues",
    help: "The number of issues with no labels."
});


export class RepoWatcher {
	constructor(
		private readonly octokit: Octokit,
		private readonly owner: string,
		private readonly repo: string,
		private readonly githubLabels: string[],
		private readonly filterTeamMembers: Set<string>,
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
				author: issue.node.author?.login,
				labels: new Set(issue.node.labels.edges.map(l => l.node.name)),
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
		for (const label of this.githubLabels) {
			openIssuesDaysGauge.remove({ repository, label });
			for (const issue of openIssues.filter(i => i.labels.has(label))) {
				const community = this.filterTeamMembers.has(issue.author);
				const age = Math.floor(Date.now() - issue.createdAt.getTime() / DAY_MS);
				openIssuesDaysGauge.observe({ community: community.toString(), repository, label: label }, age);
			}
		}

        unlabeledIssuesGauge.set(
            {repository},
            openIssues.filter(i => i.labels.size === 0).length
        );
		
		
		const closedIssues = await this.fetchIssues("CLOSED", new Date(
			Date.now() - (7 * DAY_MS)
		));
		
		for (const label of this.githubLabels) {
			const allIssues = closedIssues.filter(i => i.labels.has(label));
			const ownTeam = allIssues.filter(i => this.filterTeamMembers.has(i.author)).length;
			closedIssuesGauge.set({
				isCommunity: "false",
				repository,
				label,
			}, ownTeam);
            if (this.filterTeamMembers.size) {
                closedIssuesGauge.set({
                    isCommunity: "true",
                    repository,
                    label,
                }, allIssues.length - ownTeam);
            }
		}
	}
}