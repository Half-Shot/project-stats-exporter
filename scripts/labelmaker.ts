import 'dotenv/config';

// Script to set some labels across several projects
import { Octokit } from "octokit";

const {
	EXPORTER_REPOS,
	EXPORTER_REPO_TEMPLATE,
	EXPORTER_LABELS,
	EXPORTER_TOKEN,
} = process.env;


async function main() {
	if (!EXPORTER_TOKEN) {
		throw Error('No EXPORTER_TOKEN provided, cannot start');
	}
	if (!EXPORTER_REPOS) {
		throw Error('No EXPORTER_REPOS provided, cannot start');
	}
	if (!EXPORTER_LABELS) {
		throw Error('No EXPORTER_LABELS provided, cannot start');
	}
	if (!EXPORTER_REPO_TEMPLATE) {
		throw Error('No EXPORTER_REPO_TEMPLATE provided, cannot start');
	}

	const interestedLabels = EXPORTER_LABELS.split(',');

	const repos = EXPORTER_REPOS.split(',');

	const octokit = new Octokit({ auth: EXPORTER_TOKEN });
	try {
		const me = (await octokit.rest.users.getAuthenticated()).data;
		console.log(`Authenticated as ${me.login}`);
	} catch (ex) {
		console.log(ex);
		throw Error('Failed to authenticate with GitHub');
	}

	const live = !process.argv.includes('--dryrun');

	console.log(`This will be a ${live ? "LIVE" : "DRY"} run`);
	const [templateOwner, templateRepo] = EXPORTER_REPO_TEMPLATE.split('/');
	const labels = (await octokit.rest.issues.listLabelsForRepo({owner: templateOwner, repo: templateRepo, per_page: 100})).data.filter(label => interestedLabels.includes(label.name));

	for (const fullName of repos) {
		const [owner, repo] = fullName.split('/');
		const existingLabels = (await octokit.rest.issues.listLabelsForRepo({
			owner, repo, per_page: 100
		})).data.filter(label => interestedLabels.includes(label.name)).map(l => l.name);
		const neededLabels = labels.filter(l => !existingLabels.includes(l.name));
		if (neededLabels.length === 0) {
			console.log(`${fullName} is up to date`);
			continue;
		}
		console.log(`${fullName} needs ${neededLabels.map(l => l.name).join(', ')}`);
		if (live) {
			// Apply new labels
			for (const label of neededLabels) {
				await octokit.rest.issues.createLabel({
					owner,
					repo,
					name: label.name,
					description: label.description || undefined,
					color: label.color
				});
				await new Promise(r => setTimeout(r, 250));
			}
		}
	}

}

main().catch(ex => {
	console.error("Fatal error:", ex);
	process.exit(1);
});