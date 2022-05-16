# project-stats-exporter

Prometheus exporter that tracks details about GitHub objects. Typically, this is used to measure progress against specific goals
for a team such as "how many issues labelled with T-Defect were closed in the last 7 days".


## Configuration

The project is configured via environment variables, documented below:

### Required

These must be defined for the service to start.

- `EXPORTER_REPOS` is a comma seperated list repositories to track. E.g. (`matrix-org/synapse,matrix-org/project-stats-exporter`)
- `EXPORTER_LABELS` is a comma seperated list of labels to track. E.g. (`bug,feature,documentation`)
- `EXPORTER_TOKEN` is the GitHub personal access token used to fetch the data.

### Optional

- `EXPORTER_PORT` sets the port that the exporter listens on (default: `8080`).
- `EXPORTER_HOST` sets the hostname that the exporter listens on (default: `127.0.0.1`)
- `EXPROTER_TEAM` sets the GitHub team (within an org) that can be used to filter whether a given issue/PR is from the community (e.g. `matrix-org/bridges`). If undefined, no filtering is done.
- `EXPORTER_PERIOD` is the number of minutes between refreshes of data for repositories (default: `60`). Repositories are not all checked at once, so a period of 60 minutes across 4 repositories would check one repository every 15 minutes.
- `EXPORTER_BEARER_TOKEN` is a token to authenticate requests with. If not provided, the `/metrics` endpoint is not secured.