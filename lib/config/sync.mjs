import { syncSkillAdapters } from '../skill-adapters.mjs'
import { syncRoleAdapters } from '../role-adapters.mjs'
import { buildPluginManifests, validatePluginManifests } from '../plugin-manifests.mjs'
import { mergeHarnessSettings } from '../structural-merge.mjs'

export function runConfigSync({
  packageRoot,
  targetDir = process.cwd(),
  harness = 'all',
  write = false,
} = {}) {
  const skills = syncSkillAdapters({
    packageRoot,
    targetDir,
    harness,
    write,
  })

  const roles = syncRoleAdapters({
    packageRoot,
    targetDir,
    harness,
    write,
  })

  const plugins = buildPluginManifests({
    packageRoot,
    targetDir,
    harness,
    write,
  })

  const validPlugins = validatePluginManifests({ packageRoot, harness }).manifests
  const settings = mergeHarnessSettings({
    packageRoot,
    targetDir,
    harness,
    write,
    pluginManifests: validPlugins,
  })

  const ok = plugins.ok && settings.ok
  const mode = write ? 'applied' : 'preview'

  return {
    ok,
    mode,
    targetDir,
    harness,
    skills,
    roles,
    plugins,
    settings,
    summary: {
      skillsCount: skills.entries.length,
      rolesCount: roles.entries.length,
      pluginsCount: plugins.entries.length,
      settingsCount: settings.entries.length,
    },
  }
}
