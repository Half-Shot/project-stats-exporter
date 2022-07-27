import * as fs from "fs/promises";
import { Octokit } from "octokit";

const fetchIssuesSrc = fs.readFile('./queries/fetchIssues.gql', 'utf8');
const fetchPullRequestsSrc = fs.readFile('./queries/fetchPullRequests.gql', 'utf8');
const fetchPullRequestsSimpleSrc = fs.readFile('./queries/fetchPullRequestsSimple.gql', 'utf8');

export interface FetchIssuesResponse {
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

export async function fetchIssues(octokit: Octokit, query: { owner: string, repo: string, after: string|number, state: "OPEN"|"CLOSED", since?: Date}): Promise<FetchIssuesResponse> {
    return octokit.graphql(await fetchIssuesSrc, { 
        owner: query.owner,
        name: query.repo,
        after: query.after,
        filter: {
            states: [query.state],
            ...(query.since && {since: query.since.toISOString()})
        }
    });
}

export interface FetchPullRequestsResponse {		
	repository: {
		pullRequests: {
			edges: {
				node: {
					id: string;
					author: {
						login: string;
					},
					updatedAt: string;
					createdAt: string;
                    isDraft: boolean;
                    reviewDecision: "APPROVED"|"CHANGES_REQUESTED"|null,
                    latestReviews: {
                        edges: {
                            node: {
                                updatedAt: string,
                                author: {
                                    login: string,
                                }
                            }
                        }[]
                    },
                    reviewRequests: {
                        edges: {
                            node: {
                                id: string,
                            },
                        }[]
                    }
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

export interface FetchPullRequestsSimpleResponse {		
	repository: {
		pullRequests: {
			edges: {
				node: {
					author: {
						login: string;
					},
                    updatedAt: string;
					createdAt: string;
                    state: string;
				}
			}[],
			pageInfo: {
              hasNextPage: boolean,
              endCursor: string,
			},
        }
    }
}


export async function fetchPullRequests(octokit: Octokit, query: { owner: string, repo: string, after: string|number, state: "OPEN"|"MERGED"|"CLOSED"}): Promise<FetchPullRequestsResponse> {
    return octokit.graphql(await fetchPullRequestsSrc, { 
        owner: query.owner,
        name: query.repo,
        after: query.after,
        state: query.state,
    });
}

export async function fetchPullRequestsMergedClosed(octokit: Octokit, query: { owner: string, repo: string, after: string|number}): Promise<FetchPullRequestsSimpleResponse> {
    return octokit.graphql(await fetchPullRequestsSimpleSrc, { 
        owner: query.owner,
        name: query.repo,
        after: query.after,
    });
}