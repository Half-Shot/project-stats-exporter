import { collectDefaultMetrics, register } from "prom-client";
import { createServer } from "http";

export function startMetricsServer(port: number, hostname: string) {
	collectDefaultMetrics();
	const server = createServer((req, res) => {
		if (req.url !== "/metrics") {
			console.log(req.url);
			res.writeHead(404, { 'Content-Type': 'application/text' });
			res.write("Unknown path. Try /metrics");
			res.end();
			return;
		}
		if (req.method !== "GET") {
			res.writeHead(405, { 'Content-Type': 'application/text' });
			res.write("Wrong method. Try using GET");
			res.end();
			return;
		}
		register.metrics().then(r => {
			res.writeHead(200, { 'Content-Type': 'application/text' });
			res.write(r);
		}).catch(() => {
			res.writeHead(500, { 'Content-Type': 'application/text' });
			res.write("Error fetching metrics");
		}).finally(() => {
			res.end();
		});
	}).listen(port, hostname);
	console.log(`Started server on ${hostname}:${port}`);
	return { server };
}