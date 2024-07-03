import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as crypto from 'crypto';
import fetch from 'node-fetch';

interface Package {
    readonly name: string;
    readonly version: string;
    url?: string;
    repo?: string;
    zipSHA256?: string;
}

async function getJson(url: string): Promise<unknown> {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `Failed to get ${url} with status code ${res.status} ${res.statusText}`
        );
    }

    return await res.json();
}

async function fetchSHA256Sum(url: string): Promise<string> {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `Failed to get ${url} with status code ${res.status} ${res.statusText}`
        );
    }

    const text = await res.text();
    const hash = text.split(' ')[0];
    if (hash.length !== 64) {
        throw new Error(`Invalid SHA256 hash: ${hash}`);
    }

    return hash;
}

async function fetchZipAndComputeSHA256(url: string): Promise<string> {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(
            `Failed to get ${url} with status code ${res.status} ${res.statusText}`
        );
    }

    const buffer = new Uint8Array(await res.arrayBuffer());
    const hash = crypto.createHash('sha256');
    hash.update(buffer);
    return hash.digest('hex');
}

async function run(): Promise<void> {
    try {
        const output: string = core.getInput('output');
        const repository: string = core.getInput('repository');
        const package_name: string = core.getInput('package');
        const token: string = core.getInput('token');
        const repo_url: string = core.getInput('repo_url');
        const prerelease_repo_url: string = core.getInput(
            'prerelease_repo_url'
        );
        const repo_author: string = core.getInput('repo_author');
        const repo_name: string = core.getInput('repo_name');
        let prerelease_repo_name: string = core.getInput(
            'prerelease_repo_name'
        );

        const repo_id: string = core.getInput('repo_id');
        let prerelease_repo_id: string = core.getInput('prerelease_repo_id');

        const [owner, repo] = repository.split('/');

        const newPackages: Package[] = [];
        const prereleasePackages: Package[] = [];

        const gh = github.getOctokit(token);
        const releases = await gh.paginate(gh.rest.repos.listReleases, {
            owner,
            repo
        });
        console.log(releases);
        for (const release of releases) {
            if (release.draft) continue;

            console.log(
                `[INFO] Processing release ${release.name} (${release.tag_name})`
            );

            let meta_asset: typeof release.assets[0] | null = null;
            let package_zip: typeof release.assets[0] | null = null;
            for (const asset of release.assets) {
                if (asset.name === 'package.json') {
                    meta_asset = asset;
                }
                if (
                    asset.name.startsWith(package_name) &&
                    asset.name.endsWith('.zip')
                ) {
                    package_zip = asset;
                }
            }

            if (meta_asset === null || package_zip === null) {
                console.log(
                    `[WARN] Release ${release.name} is missing package.json or package zip file`
                );
                continue;
            }

            const packageInfo_ = await getJson(meta_asset.browser_download_url);
            if (typeof packageInfo_ !== 'object') {
                console.error(
                    `[ERROR] Failed to parse package.json for release ${release.name}`
                );
                console.log(`Got: ${JSON.stringify(packageInfo_)}`);
                continue;
            }

            const sha256_file_name = `${package_zip.name}.sha256`;
            const package_zip_sha256_file:
                | typeof release.assets[number]
                | undefined = release.assets.find(
                asset => asset.name === sha256_file_name
            );

            let sha256Hash: string;

            if (package_zip_sha256_file) {
                sha256Hash = await fetchSHA256Sum(
                    package_zip_sha256_file.browser_download_url
                );
            } else {
                // TODO: cache the SHA256 hash to ensure it doesn't change
                sha256Hash = await fetchZipAndComputeSHA256(
                    package_zip.browser_download_url
                );
            }

            const packageInfo = packageInfo_ as Package;

            packageInfo['url'] = `${package_zip.browser_download_url}?`;
            packageInfo['repo'] = repo_url;

            if (sha256Hash) {
                if (
                    packageInfo.zipSHA256 &&
                    packageInfo.zipSHA256 !== sha256Hash
                ) {
                    throw new Error('SHA256 is already set and different');
                }
                packageInfo['zipSHA256'] = sha256Hash;
            }

            prereleasePackages.push(packageInfo);
            if (!release.prerelease) {
                newPackages.push(packageInfo);
            }
        }

        if (prerelease_repo_name === '') {
            prerelease_repo_name = `${repo_name} (prereleases)`;
        }

        if (!prerelease_repo_id && repo_id) {
            prerelease_repo_id = `${repo_id}.prereleases`;
        }

        update_repo(
            output,
            repo_url,
            repo_author,
            repo_name,
            package_name,
            repo_id,
            newPackages
        );
        update_repo(
            output,
            prerelease_repo_url,
            `${repo_author} (prerelease)`,
            prerelease_repo_name,
            package_name,
            prerelease_repo_id,
            prereleasePackages
        );
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message);
    }
}

function update_repo(
    output: string,
    url: string,
    author: string,
    name: string,
    package_name: string,
    repo_id: string,
    packages: Package[]
): void {
    if (url === '') return;

    const filename = new URL(url).pathname.split('/').pop() as string;
    const output_path = `${output}/${filename}`;

    const repoInfo = {
        packages: {} as {
            [key: string]: {versions: {[version: string]: unknown}};
        },
        author,
        name,
        id: repo_id ? repo_id : undefined, // to remove id property if not specified
        url
    };
    if (fs.existsSync(output_path)) {
        const priorRepoInfo = JSON.parse(fs.readFileSync(output_path, 'utf8'));
        repoInfo.packages = priorRepoInfo.packages;
    }

    for (const pkg of packages) {
        if (repoInfo.packages[pkg.name] === undefined)
            repoInfo.packages[pkg.name] = {versions: {}};
        repoInfo.packages[pkg.name].versions[pkg.version] = pkg;
    }

    fs.writeFileSync(output_path, JSON.stringify(repoInfo, null, 2));
}

run();
