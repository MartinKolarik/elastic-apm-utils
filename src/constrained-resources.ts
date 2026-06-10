import fs from 'node:fs';
import os from 'node:os';

const originalTotalmem = os.totalmem;
const originalFreemem = os.freemem;
let patched = false;
let cgroupCpuState: { time: bigint; usage: bigint } | undefined;

function readFile (path: string): string | undefined {
	try {
		return fs.readFileSync(path, 'utf8').trim();
	} catch {
		return undefined;
	}
}

function readNumber (path: string): number | undefined {
	const value = readFile(path);

	if (!value) {
		return undefined;
	}

	const number = Number(value);

	if (!Number.isFinite(number)) {
		return undefined;
	}

	return number;
}

function parseCpuSet (cpus: string | undefined): number | undefined {
	if (!cpus) {
		return undefined;
	}

	let count = 0;

	for (const part of cpus.split(',')) {
		const range = part.split('-');
		const start = Number(range[0]);
		const end = range[1] === undefined ? undefined : Number(range[1]);

		if (!Number.isInteger(start)) {
			continue;
		}

		if (end !== undefined && Number.isInteger(end)) {
			count += end - start + 1;
		} else {
			count++;
		}
	}

	return count || undefined;
}

function getCgroupCpuQuota (): number | undefined {
	const cpuMax = readFile('/sys/fs/cgroup/cpu.max');

	if (cpuMax) {
		const parts = cpuMax.split(/\s+/);
		const quota = parts[0];
		const period = parts[1];

		if (quota !== 'max') {
			const quotaNumber = Number(quota);
			const periodNumber = Number(period);

			if (quotaNumber > 0 && periodNumber > 0) {
				return quotaNumber / periodNumber;
			}
		}
	}

	const quota = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
	const period = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_period_us');

	if (quota && period && quota > 0 && period > 0) {
		return quota / period;
	}

	return undefined;
}

function getCgroupCpuSetLimit (): number | undefined {
	return parseCpuSet(readFile('/sys/fs/cgroup/cpuset.cpus.effective'))
		|| parseCpuSet(readFile('/sys/fs/cgroup/cpuset.cpus'))
		|| parseCpuSet(readFile('/sys/fs/cgroup/cpuset/cpuset.cpus'))
		|| os.availableParallelism?.();
}

function getConstrainedCpuLimit (): { limit: number; hostCpuCount: number } | undefined {
	const hostCpuCount = os.cpus().length;
	const quota = getCgroupCpuQuota();
	const cpuset = getCgroupCpuSetLimit();
	const limits = [ quota, cpuset ].filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);

	if (!limits.length) {
		return undefined;
	}

	const limit = Math.min(...limits, hostCpuCount);

	if (limit >= hostCpuCount) {
		return undefined;
	}

	return {
		limit,
		hostCpuCount,
	};
}

function getCgroupCpuUsage (): bigint | undefined {
	const cpuStat = readFile('/sys/fs/cgroup/cpu.stat');
	const usageUsecMatch = cpuStat?.match(/^usage_usec\s+(\d+)$/m);
	const usageUsec = usageUsecMatch?.[1];

	if (usageUsec) {
		return BigInt(usageUsec) * 1000n;
	}

	const usage = readFile('/sys/fs/cgroup/cpuacct/cpuacct.usage');

	if (usage && /^\d+$/.test(usage)) {
		return BigInt(usage);
	}

	return undefined;
}

function getCgroupCpuPercent (limit: number): number | undefined {
	const usage = getCgroupCpuUsage();
	const time = process.hrtime.bigint();

	if (usage === undefined) {
		return undefined;
	}

	if (!cgroupCpuState) {
		cgroupCpuState = { time, usage };
		return undefined;
	}

	const usageDelta = usage - cgroupCpuState.usage;
	const timeDelta = time - cgroupCpuState.time;
	cgroupCpuState = { time, usage };

	if (usageDelta < 0n || timeDelta <= 0n) {
		return undefined;
	}

	return Math.min(Number(usageDelta) / Number(timeDelta) / limit, 1);
}

function capCpuPercent (value: number) {
	return Math.min(value, 1);
}

function getConstrainedMemoryStats () {
	const total = process.constrainedMemory();

	if (!total || total >= originalTotalmem()) {
		return;
	}

	return {
		total,
		free: Math.min(process.availableMemory(), total),
	};
}

export function useConstrainedResources (): void {
	if (patched) {
		return;
	}

	if (typeof process.availableMemory === 'function' && typeof process.constrainedMemory === 'function') {
		os.totalmem = () => getConstrainedMemoryStats()?.total || originalTotalmem();
		os.freemem = () => getConstrainedMemoryStats()?.free || originalFreemem();
	}

	let Stats;

	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		Stats = require('elastic-apm-node/lib/metrics/platforms/linux/stats');
	} catch {
		patched = true;
		return;
	}

	const originalReadStats = Stats.prototype.readStats;
	const originalUpdate = Stats.prototype.update;

	Stats.prototype.readStats = function (...args: unknown[]) {
		const stats = originalReadStats.apply(this, args);

		if (typeof process.availableMemory !== 'function' || typeof process.constrainedMemory !== 'function') {
			return stats;
		}

		const memory = getConstrainedMemoryStats();

		if (memory) {
			stats.memTotal = memory.total;
			stats.memAvailable = memory.free;
		}

		return stats;
	};

	Stats.prototype.update = function (...args: unknown[]) {
		originalUpdate.apply(this, args);

		const cpu = getConstrainedCpuLimit();

		if (!cpu) {
			return;
		}

		const stats = this.stats;
		const scale = cpu.hostCpuCount / cpu.limit;

		stats['system.process.cpu.total.norm.pct'] = capCpuPercent(stats['system.process.cpu.total.norm.pct'] * scale);
		stats['system.process.cpu.user.norm.pct'] = capCpuPercent(stats['system.process.cpu.user.norm.pct'] * scale);
		stats['system.process.cpu.system.norm.pct'] = capCpuPercent(stats['system.process.cpu.system.norm.pct'] * scale);

		const systemCpu = getCgroupCpuPercent(cpu.limit);

		if (systemCpu !== undefined) {
			stats['system.cpu.total.norm.pct'] = systemCpu;
		}
	};

	patched = true;
}
