import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs';
import {wait} from './wait'
import fetch from 'node-fetch';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to get ${url} with status code ${res.status} ${res.statusText}`);
  }

  return await res.json();
}

async function run(): Promise<void> {
  try {
    const output: string = core.getInput('output');
    const repository: string = core.getInput('repository');
    const include_prereleases_s: string = core.getInput('include_prereleases');
    const package_name: string = core.getInput('package');
    const token: string = core.getInput('token');
    const repo_url: string = core.getInput('repo_url');
    const repo_author: string = core.getInput('repo_author');
    const repo_name: string = core.getInput('repo_name');

    const [ owner, repo ] = repository.split('/');

    let newPackages: unknown[] = [];
    let include_prereleases;
    switch (include_prereleases_s) {
      case 'true':
        include_prereleases = true;
        break;
      case 'false':
        include_prereleases = false;
        break;
      default:
        throw new Error(`Invalid value for include_prereleases: ${include_prereleases_s}`);
    }

    const gh = github.getOctokit(token);
    const releases = await gh.rest.repos.listReleases({ owner, repo });
    if (releases.status !== 200) throw new Error(`Failed to get releases for ${repository}`);
    for (const release of releases.data) {
      if (release.draft) continue;
      if (release.prerelease && !include_prereleases) continue;

      let meta_asset: (typeof release.assets)[0] | null = null;
      let package_zip: (typeof release.assets)[0] | null = null;
      for (const asset of release.assets) {
        if (asset.name === 'package.json') {
          meta_asset = asset;
        }
        if (asset.name.startsWith(package_name) && asset.name.endsWith(".zip")) {
          package_zip = asset;
        }
      }

      if (meta_asset === null || package_zip === null) {
        console.log("[WARN] Release " + release.name + " is missing package.json or package zip file");
        continue;
      }

      let packageInfo_ = await getJson(meta_asset.browser_download_url);
      if (typeof(packageInfo_) !== 'object') {
        console.error("[ERROR] Failed to parse package.json for release " + release.name);
        console.log("Got: " + JSON.stringify(packageInfo_));
        continue;
      }
      const packageInfo = packageInfo_ as { [key: string]: unknown };
      packageInfo['url'] = package_zip.browser_download_url;
      packageInfo['repo'] = repo_url;
      newPackages.push(packageInfo);
    }
  
    const repoInfo = {
      packages: [] as unknown[],
      author: repo_author,
      name: repo_name,
      url: repo_url,
    }
    if (fs.existsSync(output)) {
      const priorRepoInfo = JSON.parse(fs.readFileSync(output, 'utf8'));
      repoInfo.packages = priorRepoInfo.packages;
    }

    repoInfo.packages.push(...newPackages);
    fs.writeFileSync(output, JSON.stringify(repoInfo, null, 2));
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
