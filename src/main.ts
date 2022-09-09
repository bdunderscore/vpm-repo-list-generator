import * as core from '@actions/core'
import * as github from '@actions/github'
import {wait} from './wait'

async function run(): Promise<void> {
  try {
    const output: string = core.getInput('output');
    const repository: string = core.getInput('repository');
    const include_prereleases_s: string = core.getInput('include_prereleases');
    const package_name: string = core.getInput('package');
    const token: string = core.getInput('token');

    const [ owner, repo ] = repository.split('/');

    const gh = github.getOctokit(token);
    const releases = await gh.rest.repos.listReleases({ owner, repo });
    if (releases.status !== 200) throw new Error(`Failed to get releases for ${repository}`);
    for (const release of releases.data) {
      let meta_asset = null;
      release.assets.forEach(asset => {
        if (asset.name === 'vpm-metadata.json') {
          meta_asset = asset;
        }
      });

      // fetch and parse metadata file
      // update/generate listing
    }

    const ms: string = core.getInput('milliseconds')
    core.debug(`Waiting ${ms} milliseconds ...`) // debug is only output if you set the secret `ACTIONS_STEP_DEBUG` to true

    core.debug(new Date().toTimeString())
    await wait(parseInt(ms, 10))
    core.debug(new Date().toTimeString())

    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
