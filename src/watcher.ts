import { Octokit } from "octokit";
import { Gauge, Histogram } from "prom-client";
import { fetchIssues, FetchIssuesResponse, fetchPullRequests, fetchPullRequestsMergedClosed, FetchPullRequestsResponse, FetchPullRequestsSimpleResponse } from "./gql";

interface CurrentIssue {
	labels: Set<string>;
	author: string;
	createdAt: Date;
	updatedAt: Date;
}


interface CurrentPullRequest {
	firstReview?: Date,
	isReviewRequested?: boolean,
	author: string;
	createdAt: Date;
	updatedAt: Date;
	state?: string;
	isApproved?: boolean;
}


const DAY_MS = 24 * 60 * 60 * 1000;

const openIssuesDaysBucket = new Histogram({
    labelNames: ["label", "repository", "isCommunity"],
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

const openPullRequestsDaysBucket = new Histogram({
    labelNames: ["label", "isCommunity", "repository"],
    name: "github_pull_requests_open_days",
    help: "The number of open PRs.",
	buckets: [
		1,
		2,
		4,
		7,
		14,
	]
});

const pullRequestsTimeToReviewDaysBucket = new Histogram({
    labelNames: ["repository", "isCommunity"],
    name: "github_pull_requests_time_to_review_days",
    help: "The time time taken to get a first review on a PR.",
	buckets: [
		1,
		2,
		4,
		7,
		14,
	]
});

enum PullRequestReviewState {
	NotReviewed = "not-reviewed",
	WaitingForReview = "waiting-for-re-review",
	WaitingForChanges = "waiting-for-changes",
	Approved = "approved"
}

const pullRequestsReviewState = new Gauge({
    labelNames: ["repository", "isCommunity", "state"],
    name: "github_pull_requests_review_status",
    help: "The state a pull requests is in for reviews."
});

const pullRequestsClosed = new Gauge({
    labelNames: ["isCommunity", "repository"],
    name: "github_pull_requests_closed",
    help: "The number of closed pull requests in the last 7 days."
});

const pullRequestsMerged = new Gauge({
    labelNames: ["isCommunity", "repository"],
    name: "github_pull_requests_merged",
    help: "The number of merged pull requests in the last 7 days."
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
		let res: FetchIssuesResponse;
		do {
			res = await fetchIssues(this.octokit, { owner: this.owner, repo: this.repo, after: res?.repository.issues.pageInfo.endCursor, state, since});
			issues.push(...res.repository.issues.edges.map(issue => ({
				author: issue.node.author?.login,
				labels: new Set(issue.node.labels.edges.map(l => l.node.name)),
				createdAt: new Date(issue.node.createdAt),
				updatedAt: new Date(issue.node.updatedAt),
			} as CurrentIssue)));
		} while (res.repository.issues.pageInfo.hasNextPage)
		return issues;
	}

	public async refreshIssueMetrics() {
		openIssuesDaysBucket.reset();
		// Fetch existing data
		const openIssues = await this.fetchIssues("OPEN");
        const repository = `${this.owner}/${this.repo}`;
		for (const label of this.githubLabels) {
			for (const issue of openIssues.filter(i => i.labels.has(label))) {
				const community = this.filterTeamMembers.has(issue.author);
				const age = Math.floor((Date.now() - issue.createdAt.getTime()) / DAY_MS);
				openIssuesDaysBucket.observe({ isCommunity: community.toString(), repository, label: label }, age);
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
	
	public async fetchPullRequests(): Promise<CurrentPullRequest[]> {
		const prs: CurrentPullRequest[] = [];
		let res: FetchPullRequestsResponse;
		do {
			res = await fetchPullRequests(this.octokit, { owner: this.owner, repo: this.repo, after: res?.repository.pullRequests.pageInfo.endCursor, state: "OPEN"});
			prs.push(...res.repository.pullRequests.edges.map(pr => {
				if (pr.node.isDraft) {
					// Ignore draft PRs
					return;
				}
				const firstReviewStr = pr.node.latestReviews?.edges?.[0]?.node?.updatedAt;
				return {
					author: pr.node.author.login,
					createdAt: new Date(pr.node.createdAt),
					updatedAt: new Date(pr.node.updatedAt),
					firstReview: firstReviewStr && new Date(firstReviewStr),
					isReviewRequested: !!pr.node.reviewRequests?.edges?.length,
					isApproved: pr.node.reviewDecision === "APPROVED",
				} as CurrentPullRequest
			}).filter(p => !!p));
		} while (res.repository.pullRequests.pageInfo.hasNextPage)
		return prs;
	}
	
	public async fetchPullRequestsMergedClosed(since: Date): Promise<CurrentPullRequest[]> {
		const prs: CurrentPullRequest[] = [];
		let res: FetchPullRequestsSimpleResponse;
		let end = false;
		do {
			res = await fetchPullRequestsMergedClosed(this.octokit, { owner: this.owner, repo: this.repo, after: res?.repository.pullRequests.pageInfo.endCursor});
			for (const pr of res.repository.pullRequests.edges) {
				const currentPR: CurrentPullRequest = {
					author: pr.node.author.login,
					createdAt: new Date(pr.node.createdAt),
					updatedAt: new Date(pr.node.updatedAt),
					state: pr.node.state,
				}
				if (currentPR.updatedAt < since) {
					console.log(currentPR.updatedAt.toISOString(), prs.length);
					end = true;
					break;
				}
				prs.push(currentPR);
			}
		} while (!end && res.repository.pullRequests.pageInfo.hasNextPage)
		return prs;
	}

	public async refreshPrMetrics() {
		const openPullRequests = await this.fetchPullRequests();
        const repository = `${this.owner}/${this.repo}`;
		
		openPullRequestsDaysBucket.reset();
		pullRequestsTimeToReviewDaysBucket.reset();
		pullRequestsReviewState.reset();
		pullRequestsClosed.reset();
		pullRequestsMerged.reset();
	
		for (const pr of openPullRequests) {
			const community = this.filterTeamMembers.has(pr.author);
			const age = Math.floor((Date.now() - pr.createdAt.getTime()) / DAY_MS);
			openPullRequestsDaysBucket.observe({ isCommunity: community.toString(), repository }, age);

			if (pr.firstReview) {
				const timeToFirstReview = Math.floor((pr.firstReview.getTime() - pr.createdAt.getTime()) / DAY_MS);
				pullRequestsTimeToReviewDaysBucket.observe({ isCommunity: community.toString(), repository }, timeToFirstReview);
			}
			if (pr.isApproved) {
				pullRequestsReviewState.inc({ isCommunity: community.toString(), repository, state: PullRequestReviewState.Approved});
			} else if (!pr.firstReview) {
				pullRequestsReviewState.inc({ isCommunity: community.toString(), repository, state: PullRequestReviewState.NotReviewed});
			} else if (pr.isReviewRequested) {
				pullRequestsReviewState.inc({ isCommunity: community.toString(), repository, state: PullRequestReviewState.WaitingForReview});
			} else {
				pullRequestsReviewState.inc({ isCommunity: community.toString(), repository, state: PullRequestReviewState.WaitingForChanges});
			}
		}

		const mergedClosedPullRequests = await this.fetchPullRequestsMergedClosed(new Date(
			Date.now() - (7 * DAY_MS)
		));
		console.log(mergedClosedPullRequests);

		for (const pr of mergedClosedPullRequests) {
			const community = this.filterTeamMembers.has(pr.author);
			if (pr.state === "CLOSED") {
				pullRequestsClosed.inc({ isCommunity: community.toString(), repository });
			} else if (pr.state === "MERGED") {
				pullRequestsMerged.inc({ isCommunity: community.toString(), repository });
			}
		}

}

	public async refreshMetrics() {
		await this.refreshIssueMetrics();
		await this.refreshPrMetrics();
	}
}