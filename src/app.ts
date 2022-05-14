import 'dotenv/config';
import { startMetricsServer } from "./metrics";
import { Octokit } from "octokit";
import { RepoWatcher } from "./watcher";

const {
	EXPORTER_PORT,
	EXPORTER_HOST,
	EXPROTER_TEAM,
	EXPORTER_REPOS,
	EXPORTER_LABELS,
	EXPORTER_TOKEN,
	EXPORTER_PERIOD
} = process.env;

async function main() {
	const port = EXPORTER_PORT ? parseInt(EXPORTER_PORT, 10) : 8080;
	// Start metrics
	const { server } = startMetricsServer(port, EXPORTER_HOST || "127.0.0.1");

	process.on('beforeExit', () => {
		server.close();
	});

	if (!EXPORTER_TOKEN) {
		throw Error('No EXPORTER_TOKEN provided, cannot start');
	}
	if (!EXPORTER_REPOS) {
		throw Error('No EXPORTER_REPOS provided, cannot start');
	}
	if (!EXPORTER_LABELS) {
		throw Error('No EXPORTER_LABELS provided, cannot start');
	}

	const repos = EXPORTER_REPOS.split(',');
	const filterLabels = EXPORTER_LABELS.split(',');
	const refreshPeriodMinutes = EXPORTER_PERIOD ? parseInt(EXPORTER_PERIOD, 10) : 60;

	const octokit = new Octokit({ auth: EXPORTER_TOKEN });
	try {
		const me = (await octokit.rest.users.getAuthenticated()).data;
		console.log(`Authenticated as ${me.login}`);
	} catch (ex) {
		console.log(ex);
		throw Error('Failed to authenticate with GitHub');
	}

	let filterTeamMembers: Set<string> = new Set();

	if (EXPROTER_TEAM) {
		const [ org, team ] = EXPROTER_TEAM.split('/');
		const members = (await octokit.rest.teams.listMembersInOrg({ org, team_slug: team })).data;
		filterTeamMembers = new Set(members.map(m => m.login));
		console.log(`Filtering out ${filterTeamMembers.size} team members in ${EXPROTER_TEAM}`);
	}

	const watchers: RepoWatcher[] = [];
	for (const fullRepoName of repos) {
		const [ org, repo ] = fullRepoName.split('/');
		const watcher = new RepoWatcher(octokit, org, repo, filterLabels, filterTeamMembers);
		await watcher.refreshMetrics();
		watchers.push(watcher);
	}
	console.log(`Watching ${watchers.length} repositories`);
	let watcherIndex = 0;

	const refreshPeriod = Math.ceil(refreshPeriodMinutes / watchers.length);

	const int = setInterval(() => {
		watchers[watcherIndex].refreshMetrics();
		watcherIndex++;
		if (watcherIndex === watchers.length) {
			watcherIndex = 0;
		}
	}, refreshPeriod * 60000);
	process.on('beforeExit', () => clearInterval(int));
	console.log(`Refreshing metrics every ${refreshPeriod} minutes`);
}

main().catch(ex => {
	console.error("Fatal error:", ex);
	process.exit(1);
});