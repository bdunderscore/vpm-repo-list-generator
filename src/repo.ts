import {createHash} from 'crypto';
import * as fs from 'fs';

export interface Package {
    readonly name: string;
    readonly version: string;
    url: string;
    package_info: () => Promise<VPMPackage | null>;
}

export interface VPMPackage {
    name?: string;
    version?: string;
    displayName?: string;
    description?: string;
    url?: string;
    repo?: string;
    zipSHA256?: string;

    [key: string]: unknown;
}

export interface VPMRepositoryData {
    packages?: {[key: string]: {versions: {[version: string]: VPMPackage}}};
    author?: string;
    name?: string;
    id?: string;
    url?: string;
}

export interface VPMRepositoryInit {
    author: string;
    name: string;
    id?: string;
    url: string;
}

export class VPMRepository {
    readonly file_path: string;
    readonly data: VPMRepositoryData;
    readonly packages: {
        [key: string]: {versions: {[version: string]: VPMPackage}};
    } = {};

    constructor(path: string, init: VPMRepositoryInit) {
        this.file_path = path;

        if (fs.existsSync(path)) {
            this.data = JSON.parse(fs.readFileSync(path, 'utf-8'));
        } else {
            this.data = {...init, packages: {}};
        }

        if (this.data.packages === undefined) {
            this.data.packages = {};
        }

        this.packages = this.data.packages;
    }

    async fetchAndComputeSha256(url: string): Promise<string | undefined> {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(
                    `Failed to fetch ${url}: ${res.status} ${res.statusText}`
                );
            }
            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const hash = createHash('sha256').update(buffer).digest('hex');
            return hash;
        } catch (error) {
            console.error(
                `Error fetching or computing SHA256 for ${url}:`,
                error
            );
            return undefined;
        }
    }

    async addPackage(pkg: Package): Promise<void> {
        let version_info: VPMPackage | null =
            this.packages[pkg.name]?.versions[pkg.version];

        if (version_info === undefined) {
            console.log(
                `[INFO] Adding package ${pkg.name}@${pkg.version} to the repository.`
            );
            version_info = await pkg.package_info();

            if (version_info === null) {
                console.log(
                    `[ERROR] Failed to retrieve package info for ${pkg.name}@${pkg.version}`
                );
                return;
            }

            if (this.packages[pkg.name] === undefined) {
                this.packages[pkg.name] = {versions: {}};
            }

            if (version_info.name === undefined) {
                version_info.name = pkg.name;
            }

            if (
                version_info.name !== pkg.name ||
                version_info.version !== pkg.version
            ) {
                console.error(
                    `[ERROR] Package name or version mismatch: expected ${pkg.name}@${pkg.version}, got ${version_info.name}@${version_info.version}`
                );
                return;
            }

            this.packages[pkg.name].versions[pkg.version] = version_info;

            if (version_info.repo === null) {
                version_info.repo = this.data.url;
            }
        }

        if (version_info.zipSHA256 === undefined) {
            version_info.zipSHA256 = await this.fetchAndComputeSha256(pkg.url);
            console.log(
                `[INFO] Computed SHA256 for ${pkg.url}: ${version_info.zipSHA256}`
            );
            if (version_info.zipSHA256 === null) {
                console.error(
                    `[ERROR] Failed to compute SHA256 for ${pkg.url}`
                );
                return;
            }
        }
    }

    save(): void {
        fs.writeFileSync(this.file_path, JSON.stringify(this.data, null, 2));
    }
}
