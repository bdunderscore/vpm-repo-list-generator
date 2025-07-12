import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import fetch from 'node-fetch';
import { VPMPackage, VPMRepository } from './repo';

interface Package {
    readonly name: string;
    readonly version: string;
    url?: string;
    repo?: string;
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

export async function run(): Promise<void> {
    try {
        const output: string = core.getInput('output');
        const repository: string = core.getInput('repository');
        const package_name: string = core.getInput('package');
        const token: string = core.getInput('token');
        const repo_url: string = core.getInput('repo_url');
        const repo_author: string = core.getInput('repo_author');
        const repo_name: string = core.getInput('repo_name');
        const repo_id: string = core.getInput('repo_id');

        const doc_url: string = core.getInput('doc_url', {
            required: false
        });

        const [owner, repo] = repository.split('/');

        const newPackages: Package[] = [];
        const prereleasePackages: Package[] = [];

        const repo_file_name = new URL(repo_url).pathname.split('/').pop() as string;
        const repo_file_path = `${output}/${repo_file_name}`;
        const vpm_repo = new VPMRepository(repo_file_path, {
            author: repo_author,
            name: repo_name,
            id: repo_id,
            url: repo_url
        });

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

            let meta_asset: (typeof release.assets)[0] | null = null;
            let package_zip: (typeof release.assets)[0] | null = null;
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

            let zipSHA256: string | undefined = undefined;

            const digest = (package_zip as any).digest;
            if (digest !== null) {
                if (digest.startsWith('sha256:')) {
                    zipSHA256 = digest.slice(7);
                }
            }

            const get_package_info = async function() {
                console.log(`[INFO] Fetching package info for ${release.name}`);
                const packageInfo_ = await getJson(meta_asset!.browser_download_url);
                if (typeof packageInfo_ !== 'object') {
                    console.error(
                        `[ERROR] Failed to parse package.json for release ${release.name}`
                    );
                    console.log(`Got: ${JSON.stringify(packageInfo_)}`);
                    return null;
                }

                const packageInfo = packageInfo_ as VPMPackage;

                packageInfo['url'] = `${package_zip!.browser_download_url}?`;
                packageInfo['repo'] = repo_url;
                packageInfo['zipSHA256'] = zipSHA256;

                if (doc_url !== "") {
                    packageInfo["documentationUrl"] = doc_url;
                }
                // Temporary until we get the HTML changelog generation and anchors sorted out
                packageInfo['changelogUrl'] = release.html_url;

                console.log(`[INFO] Package info for ${release.name}: ${JSON.stringify(packageInfo)}`);

                return packageInfo;
            }

            await vpm_repo.addPackage({
                name: package_name,
                version: release.tag_name,
                url: package_zip.browser_download_url,
                package_info: get_package_info
            });
        }

        vpm_repo.save();
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message);
    }
}

run();
