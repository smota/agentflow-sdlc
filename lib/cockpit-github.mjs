// Compatibility facade. GitHub is a source adapter; Cockpit consumes that source contract.
export {
  GitHubApiError,
  createGitHubClient,
  loadRepositoryPermission,
} from './sources/github-client.mjs'
